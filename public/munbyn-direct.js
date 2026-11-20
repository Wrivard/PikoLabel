// Experimental direct BLE printing for MUNBYN ITPP130B (203 DPI, TSPL, FFF2).
// Print bytes are generated on the tablet; no third-party file import.
const TE=new TextEncoder(),DPI=203,delay=ms=>new Promise(r=>setTimeout(r,ms));
const uuid=n=>"0000"+n.toString(16).padStart(4,"0")+"-0000-1000-8000-00805f9b34fb";
const services=[0xfff0,0xff00,0xffe0,0xffa0,0xffd0,0xffb0,0xffe5];
let device=null,writer=null,listener=()=>{},busy=false;
const report=(message,type="info")=>listener(message,type);
export const setPrinterStatusListener=fn=>listener=fn;
export const isPrinterConnected=()=>!!(writer&&device?.gatt?.connected);
export const webBluetoothSupported=()=>typeof navigator!=="undefined"&&!!navigator.bluetooth;
export function disconnectPrinter(){if(busy)throw Error("Printing in progress.");writer=null;device?.gatt?.disconnect();report("Bluetooth disconnected.");}
export async function connectPrinter(){
 if(isPrinterConnected())return device.name||"MUNBYN";
 if(!webBluetoothSupported())throw Error("Use Google Chrome on Android for direct Bluetooth access.");
 // Request is performed at the start of a click action (browser permission requirement).
 report("Select your MUNBYN ITPP130B in the Bluetooth picker…");
 const selected=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:services.map(uuid)});
 if(device&&device!==selected&&device.gatt?.connected)device.gatt.disconnect();
 device=selected;writer=null;
 selected.addEventListener("gattserverdisconnected",()=>{if(device===selected){writer=null;report("Disconnected. Tap Connect to reconnect.","warning");}});
 report("Connecting to "+(selected.name||"device")+"…");
 const gatt=await selected.gatt.connect();
 for(const n of services){try{
   const characteristic=await (await gatt.getPrimaryService(uuid(n))).getCharacteristic(uuid(0xfff2));
   if(characteristic.properties.write&&typeof characteristic.writeValueWithResponse==="function"){writer=characteristic;break;}
 }catch{}}
 if(!writer){gatt.disconnect();throw Error("The printer connected, but no writable FFF2 service was found. This firmware may require a native Android print bridge.");}
 report("Connected: "+(selected.name||"ITPP130B")+". Print a test label first.","success");
 return selected.name||"MUNBYN";
}
export function rgbaToBitmap(rgba,width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1000||height>1800||rgba.length<width*height*4)throw Error("Invalid label bitmap.");
 const stride=Math.ceil(width/8),output=new Uint8Array(stride*height).fill(255);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=4*(y*width+x),a=rgba[i+3]/255;
   const gray=a*(.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2])+(1-a)*255;
   if(gray<160)output[y*stride+(x>>3)]&=~(128>>(x&7)); // TSPL 0=black
 }
 return {bytes:output,stride,height};
}
function concat(parts){const size=parts.reduce((n,x)=>n+x.length,0),out=new Uint8Array(size);let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;}
export function encodeTspl(bitmap,widthIn,heightIn){
 const header=TE.encode("SIZE "+(widthIn*25.4).toFixed(2)+" mm,"+(heightIn*25.4).toFixed(2)+" mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0,0\r\nREFERENCE 0,0\r\nCLS\r\n");
 const parts=[header];
 for(let y=0;y<bitmap.height;y+=32){
   const rows=Math.min(32,bitmap.height-y);
   parts.push(TE.encode("BITMAP 0,"+y+","+bitmap.stride+","+rows+",0,"));
   parts.push(bitmap.bytes.subarray(y*bitmap.stride,(y+rows)*bitmap.stride));
   parts.push(TE.encode("\r\n"));
 }
 parts.push(TE.encode("PRINT 1,1\r\n"));
 return concat(parts);
}
function rowsOf(name,address){return [name,address?.line1,address?.line2,address?.cityStatePostal,address?.country].map(x=>String(x||"").trim()).filter(Boolean);}
function render(title,lines,w,h){
 const canvas=document.createElement("canvas");canvas.width=Math.round(w*DPI);canvas.height=Math.round(h*DPI);
 const ctx=canvas.getContext("2d",{willReadFrequently:true});
 if(!ctx)throw Error("Canvas printing is unsupported by this browser.");
 ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#000";
 const margin=Math.round(.13*DPI),max=canvas.width-2*margin;
 let font=Math.min(30,Math.round(10*DPI/72)),linesOut=[],lineHeight=0;
 function wrap(size){
   ctx.font=size+"px Arial";const out=[];
   for(const line of lines){
     let current="";
     for(let word of line.split(/\s+/)){
       if(!word)continue;
       if(ctx.measureText(word).width>max){
         if(current){out.push(current);current="";}
         let p="";for(const ch of word){if(p&&ctx.measureText(p+ch).width>max){out.push(p);p="";}p+=ch;}if(p)out.push(p);
         continue;
       }
       const next=current?current+" "+word:word;
       if(current&&ctx.measureText(next).width>max){out.push(current);current=word;}else current=next;
     }
     if(current)out.push(current);
   }
   return out;
 }
 while(font>=17){linesOut=wrap(font);lineHeight=Math.ceil(font*1.22);if(margin+36+linesOut.length*lineHeight<=canvas.height-margin)break;font--;}
 if(font<17)throw Error("Address does not fit. Use a larger label or shorten the address.");
 ctx.textBaseline="top";ctx.font="bold 26px Arial";ctx.fillText(title,margin,margin);
 ctx.font=font+"px Arial";let y=margin+36;for(const line of linesOut){ctx.fillText(line,margin,y);y+=lineHeight;}
 return rgbaToBitmap(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
}
export function pagesForOrder(order,settings){
 const w=Number(settings.labelWidth)||2.25,h=Number(settings.labelHeight)||1.25;
 if(w<2.2||w>4.3||h<1.25||h>6.2)throw Error("Invalid thermal label size.");
 const from=rowsOf(settings.returnName,settings.returnAddress),to=rowsOf(order.shipTo?.name,order.shipTo);
 if(from.length<3)throw Error("Add your return name and full address in Business details first.");
 if(to.length<3)throw Error("Recipient address is incomplete. Check this eBay order.");
 return [render("Ship from",from,w,h),render("Ship to",to,w,h)];
}
export function testPage(settings){return render("PIKO TEST",["Bluetooth test","No buyer data","Check label alignment"],Number(settings.labelWidth)||2.25,Number(settings.labelHeight)||1.25);}
export async function printPages(pages,settings){
 if(busy)throw Error("Another print job is active.");
 if(!isPrinterConnected())throw Error("Connect MUNBYN Bluetooth first.");
 if(pages.length===0||pages.length>50)throw Error("Select 1–25 orders.");
 busy=true;let attempted=false;
 try{
   for(let i=0;i<pages.length;i++){
     const bytes=encodeTspl(pages[i],Number(settings.labelWidth)||2.25,Number(settings.labelHeight)||1.25);
     report("Sending label "+(i+1)+" of "+pages.length+"…");
     for(let pos=0;pos<bytes.length;pos+=128){
       if(!isPrinterConnected())throw Error("Bluetooth disconnected.");
       attempted=true;
       await writer.writeValueWithResponse(bytes.subarray(pos,Math.min(pos+128,bytes.length)));
       await delay(12);
     }
     await delay(1000);
   }
   report(pages.length+" label(s) transmitted. Check the paper to confirm printing.","success");
 }catch(e){
   report((attempted?"Transmission may have partially printed. Check the paper before retrying. ":"")+e.message,"error");throw e;
 }finally{busy=false;}
}
export async function printOrders(orders,settings){
 if(!orders.length||orders.length>25)throw Error("Select between 1 and 25 orders.");
 const pages=orders.flatMap(o=>pagesForOrder(o,settings)); // prevalidate before sending
 await printPages(pages,settings);
}
