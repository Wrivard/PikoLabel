// Dependency-free PDF layout for small thermal address labels and US Letter slips.
// Uses embedded core fonts and Windows-1252 characters; unsupported glyphs become '?'.
const PT = 72;
const clean = value => String(value ?? '').replace(/[\r\t]/g, ' ').trim();
function cp1252(str) {
  const map = { 0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f };
  const bytes=[];
  for (const ch of String(str)) { const c=ch.codePointAt(0); bytes.push(c<=255?c:map[c]??63); }
  return bytes;
}
function hex(str){return Buffer.from(cp1252(str)).toString('hex').toUpperCase();}
function text(x,y,value,size=10,bold=false){return `BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${hex(value)}> Tj ET\n`;}
function line(x1,y1,x2,y2,width=.65){return `${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;}
function rect(x,y,w,h,width=.5){return `${width} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S\n`;}
const widthEstimate=(s,size=10)=>[...String(s)].reduce((n,ch)=>n+(ch===' '?0.28:/[ilI\.,:;!]/.test(ch)?0.23:/[MW@]/.test(ch)?0.85:0.53)*size,0);
function wrap(str, maxWidth, size, maxLines=40) {
  let rows=[];const words=String(str||'').split(/\s+/).filter(Boolean);let current='';
  for(let word of words){
    let candidate=current?current+' '+word:word;
    if(widthEstimate(candidate,size)<=maxWidth){current=candidate;continue;}
    if(current){rows.push(current);current='';}
    while(widthEstimate(word,size)>maxWidth && word.length>1){
      let i=1;while(i<word.length && widthEstimate(word.slice(0,i+1),size)<=maxWidth)i++;
      rows.push(word.slice(0,i));word=word.slice(i);
    }
    current=word;
    if(rows.length>=maxLines)break;
  }
  if(current&&rows.length<maxLines)rows.push(current);
  return rows;
}
function createPdf(pages){
  // xref offsets include raw binary PDF header and all object lengths.
  const objects=[];
  const add=body=>(objects.push(body),objects.length);
  const catalog=add('');const pagesRoot=add('');
  const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageRefs=[];
  for(const pg of pages){
    const content=Buffer.from(pg.commands,'ascii');
    const stream=add(`<< /Length ${content.length} >>\nstream\n${pg.commands}endstream`);
    const page=add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${pg.w.toFixed(2)} ${pg.h.toFixed(2)}] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${stream} 0 R >>`);
    pageRefs.push(page);
  }
  objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot-1]=`<< /Type /Pages /Kids [${pageRefs.map(n=>`${n} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')];const offsets=[0];let offset=parts[0].length;
  objects.forEach((body,i)=>{offsets.push(offset);const b=Buffer.from(`${i+1} 0 obj\n${body}\nendobj\n`,'utf8');parts.push(b);offset+=b.length;});
  const xref=offset;const out=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(Buffer.from(out,'ascii'));return Buffer.concat(parts);
}
function addressLines(name,addr){return [name,addr?.line1,addr?.line2,addr?.cityStatePostal,addr?.country].filter(Boolean).map(clean);}
function renderAddressBlock(lines,x,top,w,maxH,title,fontSize){
 const headingSize=Math.min(8.3,Math.max(6.8,fontSize));
 let c=text(x,top,title,headingSize,true);let y=top-headingSize-5;
 // Fit all address lines within the physical label, wrapping instead of clipping.
 let size=fontSize,all=[];
 for(;size>=5.5;size-=.4){
   all=lines.flatMap(l=>wrap(l,w,size));
   if(all.length*(size+1.6)<=maxH-headingSize-6)break;
 }
 size=Math.max(5.5,size);
 for(const row of all){c+=text(x,y,row,size,false);y-=size+1.6;}
 return c;
}
export function labelsPdf(orders,settings){
 const w=(Number(settings.labelWidth)||2.25)*PT,h=(Number(settings.labelHeight)||1.25)*PT;
 if(w<2.2*PT||w>4.3*PT||h<1.25*PT||h>6.2*PT)throw new Error('Unsupported thermal label dimensions.');
 const margin=.14*PT;
 const innerW=w-2*margin;
 const sender=addressLines(settings.returnName,settings.returnAddress);
 const pages=[];
 for(const order of orders){
   // Tested Word format: each physical 2.25 x 1.25 inch sheet is one page.
   for(const [title,lines] of [['Ship from',sender],['Ship to',addressLines(order.shipTo?.name,order.shipTo)]]){
     let commands='0 0 0 RG 0 0 0 rg\n';
     if(settings.labelBorder===true)commands+=rect(3,3,w-6,h-6,.5);
     commands+=renderAddressBlock(lines,margin,h-margin-8,innerW,h-2*margin,title,Number(settings.labelFont)||10);
     pages.push({w,h,commands});
   }
 }
 return createPdf(pages);
}

const money=(obj)=>{if(!obj||obj.value==null)return '';const n=Number(obj.value);return Number.isFinite(n)?`${n.toFixed(2)} ${obj.currency||'CAD'}`:'';};
export function planPackingItems(items){
 const list=Array.isArray(items)?items:[];
 const columns=list.length<=13?1:list.length<=26?2:3;
 const colW=(526-(columns-1)*11)/columns;
 for(const font of [8.2,7.5,7,6.5,6.1]){
  const groupSize=Math.ceil(list.length/columns);
  const groups=Array.from({length:columns},(_,i)=>list.slice(i*groupSize,(i+1)*groupSize));
  const laid=groups.map(group=>group.map(item=>{
   const rows=wrap(item.title||'Unnamed item',colW-7,font,100);
   const height=rows.length*(font+1)+(columns===1?1:font+2)+3;
   return {item,rows,height};
  }));
  const heights=laid.map(group=>group.reduce((sum,i)=>sum+i.height,0));
  if(Math.max(0,...heights)<=350)return {columns,colW,font,laid,total:list.reduce((n,i)=>n+(Number(i.quantity)||0),0),count:list.length};
 }
 throw Error('The complete item list cannot fit legibly on one packing-slip page; no items omitted. Shorten listing titles or use a larger summary format.');
}
export function packingPdf(orders,settings){
 const w=612,h=792,m=43;
 const pages=orders.map(order=>{
  const plan=planPackingItems(order.items||[]);
  let c='0 0 0 RG 0 0 0 rg\n';
  c+=text(m,744,settings.storeName||'PIKO CARDS',21,true);
  c+=text(400,744,'PACKING SLIP',11,true);
  c+=text(400,726,'Order '+(order.displayId||order.id),8);
  c+=line(m,711,w-m,711,.9);
  c+=text(m,692,'SHIP TO',9,true);c+=text(327,692,'SHIP FROM',9,true);
  let left=677,right=677;
  for(const value of addressLines(order.shipTo?.name,order.shipTo))for(const row of wrap(value,245,9.2,80)){c+=text(m,left,row,9.2);left-=12;}
  for(const value of addressLines(settings.returnName,settings.returnAddress))for(const row of wrap(value,219,9.2,80)){c+=text(327,right,row,9.2);right-=12;}
  if(left<593||right<593)throw Error('An address is too long for a one-page packing slip.');
  c+=text(m,583,'Buyer: '+(order.buyer||'-'),8.5);
  c+=text(327,583,'Date: '+String(order.createdAt||'').slice(0,10),8.5);
  c+=line(m,569,w-m,569,.55);
  c+=text(m,555,'ITEMS ('+plan.count+' listings, '+plan.total+' cards)',8.5,true);
  c+=line(m,548,w-m,548,.35);
  for(let col=0;col<plan.laid.length;col++){
   const x=m+col*(plan.colW+11);
   let y=535;
   for(const entry of plan.laid[col]){
    for(let i=0;i<entry.rows.length;i++){c+=text(x,y,entry.rows[i],plan.font,i===0);y-=plan.font+1;}
    c+=text(x+2,y,String(entry.item.quantity??1)+' x  '+(money(entry.item.price)||'-'),Math.max(6,plan.font-1));
    y-=entry.height-entry.rows.length*(plan.font+1);
   }
   if(y<170)throw Error('Packing slip items extend into totals; no items omitted.');
  }
  c+=line(m,151,w-m,151,.6);
  c+=text(380,136,'Shipping',8.5);c+=text(480,136,money(order.shippingCost)||'-',8.5);
  c+=text(380,121,'Total',9,true);c+=text(480,121,money(order.total)||'-',9,true);
  c+=text(m,105,'A MESSAGE FROM PIKO CARDS',8,true);
  const message=String(settings.thankYouMessage||'Thanks for your purchase!');
  const lines=wrap(message,310,8,100);
  if(lines.length>3)throw Error('Thank-you message is too long for one page.');
  let yy=90;for(const line of lines){c+=text(m,yy,line,8);yy-=10;}
  c+=text(m,30,'Thank you for supporting a Canadian small business.',8);
  return {w,h,commands:c};
 });
 return createPdf(pages);
}

/** Exact-size PDF for testing each sheet in the MUNBYN. */
export function calibrationPdf(settings){
 const width=Number(settings.labelWidth)||2.25,height=Number(settings.labelHeight)||1.25;
 const w=width*PT,h=height*PT;
 if(w<2.2*PT||w>4.3*PT||h<1.25*PT||h>6.2*PT)throw new Error('Unsupported label dimensions');
 const m=.13*PT;
 let c='0 0 0 RG 0 0 0 rg\n';
 c+=rect(3,3,w-6,h-6,.6);
 c+=text(m,h-22,'TEST: '+width.toFixed(2)+' x '+height.toFixed(2)+' in',8.2,true);
 c+=text(m,h-38,'Print at 100% / actual size',7.2);
 c+=line(m,16,m+72,16,1.3)+line(m,12,m,20,.8)+line(m+72,12,m+72,20,.8);
 c+=text(m+20,23,'1 inch',7.2);
 return createPdf([{w,h,commands:c}]);
}
