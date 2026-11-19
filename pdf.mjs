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
export function packingPdf(orders,settings){
 const w=8.5*PT,h=11*PT,m=43;
 const pages=orders.map(order=>{
   let c='0 0 0 RG 0 0 0 rg\n';
   c+=text(m,h-65,settings.storeName||'PIKO CARDS',23,true);
   c+=text(w-m-175,h-60,'PACKING SLIP',11,true);
   c+=text(w-m-175,h-78,`Order ${order.displayId||order.id}`,8);
   c+=line(m,h-94,w-m,h-94,.9);
   c+=text(m,h-124,'SHIP TO',9,true);c+=text(330,h-124,'SHIP FROM',9,true);
   let y1=h-142,y2=h-142;
   for(const row of addressLines(order.shipTo?.name,order.shipTo)){for(const r of wrap(row,250,10)){c+=text(m,y1,r,10);y1-=14;}}
   for(const row of addressLines(settings.returnName,settings.returnAddress)){for(const r of wrap(row,220,10)){c+=text(330,y2,r,10);y2-=14;}}
   c+=text(m,h-248,`Buyer: ${order.buyer||'-'}`,9);
   c+=text(330,h-248,`Date: ${String(order.createdAt||'').slice(0,10)||'-'}`,9);
   c+=line(m,h-265,w-m,h-265,.8);
   c+=text(m,h-288,'ITEM',9,true);c+=text(435,h-288,'QTY',9,true);c+=text(483,h-288,'PRICE',9,true);
   c+=line(m,h-298,w-m,h-298,.4);
   let y=h-319;
   for(const item of order.items.slice(0,24)){
      const lines=wrap(item.title,372,9,3);
      for(let i=0;i<lines.length;i++){c+=text(m,y,lines[i],9,i===0);y-=12;}
      c+=text(436,y+12*lines.length-12,String(item.quantity),9);
      c+=text(483,y+12*lines.length-12,money(item.price)||'-',9);
      y-=14;
      if(y<175){c+=text(m,y,'Additional items not shown — check order in eBay.',8);break;}
   }
   const sy=Math.max(150,y-15);c+=line(355,sy,w-m,sy,.65);
   c+=text(375,sy-21,'Shipping',9);c+=text(480,sy-21,money(order.shippingCost)||'-',9);
   c+=text(375,sy-39,'Total',10,true);c+=text(480,sy-39,money(order.total)||'-',10,true);
   c+=line(m,125,w-m,125,.7);
   c+=text(m,104,'A MESSAGE FROM PIKO CARDS',8,true);
   const msg=String(settings.thankYouMessage||'Thanks for your purchase! I hope you love it!');
   let yy=87;for(const r of wrap(msg,w-2*m,9,2)){c+=text(m,yy,r,9);yy-=12;}
   c+=text(m,35,'Thank you for supporting a Canadian small business.',8);
   return {w,h,commands:c};
 });return createPdf(pages);
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
