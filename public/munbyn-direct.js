// Experimental direct BLE printing for MUNBYN ITPP130B (203 DPI, TSPL, FFF2).
// Remember only the device ID and browser-granted permission, not passwords or order data.
const TE=new TextEncoder(),DPI=203,delay=ms=>new Promise(r=>setTimeout(r,ms));
const uuid=n=>"0000"+n.toString(16).padStart(4,"0")+"-0000-1000-8000-00805f9b34fb";
const services=[0xfff0,0xff00,0xffe0,0xffa0,0xffd0,0xffb0,0xffe5];
const STORAGE_KEY="piko-munbyn-device-id";
let device=null,writer=null,listener=()=>{},busy=false,connectionPromise=null,manualStop=false;
const report=(message,type="info")=>listener(message,type);
const savedId=()=>{try{return localStorage.getItem(STORAGE_KEY)||""}catch{return ""}};
const remember=id=>{try{if(id)localStorage.setItem(STORAGE_KEY,id)}catch{}};
const forget=()=>{try{localStorage.removeItem(STORAGE_KEY)}catch{}};
export const setPrinterStatusListener=fn=>listener=fn;
export const isPrinterConnected=()=>!!(writer&&device?.gatt?.connected);
export const webBluetoothSupported=()=>typeof navigator!=="undefined"&&!!navigator.bluetooth;
export function disconnectPrinter(){
 if(busy)throw Error("Printing in progress.");
 manualStop=true;forget();writer=null;
 const old=device;device=null;
 if(old?.gatt?.connected)old.gatt.disconnect();
 report("Disconnected and forgotten on this browser. Tap Connect to authorize again.");
}
// On some Chrome/Android versions, getDevices() returns a previously authorized
// printer but the cached device cannot reconnect until it advertises again.
// Watch advertisements when supported, with a short timeout and clean cancellation.
export async function waitForPrinterAdvertisement(selected,timeoutMs=6500){
 if(typeof selected?.watchAdvertisements!=="function")return false;
 const controller=new AbortController();
 let onAdvertisement=()=>{};
 const advertisement=new Promise(resolve=>{
   onAdvertisement=()=>resolve(true);
   selected.addEventListener("advertisementreceived",onAdvertisement,{once:true});
 });
 try{
   await selected.watchAdvertisements({signal:controller.signal});
   return await Promise.race([advertisement,delay(timeoutMs).then(()=>false)]);
 }catch{return false}
 finally{
   controller.abort();
   selected.removeEventListener?.("advertisementreceived",onAdvertisement);
 }
}
function isOutOfRangeError(error){
 return /no longer in range|out of range/i.test(String(error?.message||""));
}
async function connectGatt(selected,{recover=false}={}){
 const limit=recover?3:1;
 let last;
 for(let attempt=0;attempt<limit;attempt++){
   if(manualStop)throw Error("Bluetooth connection was cancelled.");
   if(attempt>0)report("Retrying MUNBYN Bluetooth connection ("+(attempt+1)+"/"+limit+")…");
   try{return selected.gatt.connected?selected.gatt:await selected.gatt.connect()}
   catch(e){
     last=e;
     if(!recover||!isOutOfRangeError(e)||attempt===limit-1)break;
     if(attempt===0){
       report("Chrome found your saved MUNBYN but cannot reach it yet. Checking Bluetooth advertisements…","warning");
       const seen=await waitForPrinterAdvertisement(selected);
       if(!seen)await delay(1400);
     }else await delay(2000);
   }
 }
 if(recover&&isOutOfRangeError(last)){
   throw new Error("Chrome remembered the printer but Android could not restore its Bluetooth link. Turn the MUNBYN off and on, close MUNBYN Print, then tap Re-select MUNBYN. Chrome may still require manual reconnect after a reload.");
 }
 throw last;
}
async function openGatt(selected,{recover=false}={}){
 if(isPrinterConnected()&&device?.id===selected.id)return selected.name||"MUNBYN";
 if(connectionPromise)return connectionPromise;
 manualStop=false;
 if(device&&device!==selected&&device.gatt?.connected)device.gatt.disconnect();
 device=selected;writer=null;
 selected.addEventListener("gattserverdisconnected",()=>{
   if(device!==selected)return;
   writer=null;
   if(!manualStop)report("MUNBYN disconnected. Reopen the page or tap Connect to retry.","warning");
 });
 connectionPromise=(async()=>{
   report("Connecting to "+(selected.name||"MUNBYN")+"…");
   const server=await connectGatt(selected,{recover});
   let characteristic=null;
   // GATT objects must be rediscovered after every connection.
   for(const n of services){
     try{
       const service=await server.getPrimaryService(uuid(n));
       const candidate=await service.getCharacteristic(uuid(0xfff2));
       if(candidate.properties.write&&typeof candidate.writeValueWithResponse==="function"){
         characteristic=candidate;break;
       }
     }catch{}
   }
   if(!characteristic)throw Error("This MUNBYN does not expose a writable FFF2 service.");
   writer=characteristic;remember(selected.id);
   report("Connected to "+(selected.name||"MUNBYN")+". This browser remembers the printer.","success");
   return selected.name||"MUNBYN";
 })();
 try{return await connectionPromise;}
 catch(e){writer=null;if(selected.gatt?.connected)selected.gatt.disconnect();throw e;}
 finally{connectionPromise=null;}
}
export async function connectPrinter(){
 if(isPrinterConnected())return device.name||"MUNBYN";
 if(!webBluetoothSupported())throw Error("Use Chrome on Android for direct Bluetooth.");
 // requestDevice must execute in the direct user click gesture.
 manualStop=false;
 report("Choose your MUNBYN in Chrome’s Bluetooth picker…");
 const selected=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:services.map(uuid)});
 return openGatt(selected);
}
/** Reconnect to the site-authorized MUNBYN after a page reload without a new picker.
 * A physical Bluetooth session cannot persist across a browser page reload.
 */
export async function reconnectRememberedPrinter(){
 if(manualStop||isPrinterConnected())return isPrinterConnected();
 if(!webBluetoothSupported())return false;
 // Within the same open tab, re-use the live BluetoothDevice object even when
 // experimental persistent permissions are unavailable.
 if(device?.gatt&&!device.gatt.connected){
   try{await openGatt(device,{recover:true});return true}
   catch(e){report("Reconnecting saved device in this tab failed: "+(e?.message||"Unknown error"),"warning")}
 }
 if(typeof navigator.bluetooth.getDevices!=="function"){
   report("Chrome blocks restore after page refresh. Enable Experimental Web Platform features and Web Bluetooth new permissions backend in chrome://flags, then relaunch and Connect once.","warning");
   return false;
 }
 try{
   const granted=await navigator.bluetooth.getDevices();
   if(manualStop||isPrinterConnected())return isPrinterConnected();
   const id=savedId();let selected=id?granted.find(x=>x.id===id):null;
   // Existing users first granted permission before we stored the device ID.
   if(!selected&&!id){
     const found=granted.filter(x=>/munbyn|itpp130/i.test(x.name||""));
     if(found.length===1)selected=found[0];
   }
   if(!selected){
     report(id?"Saved MUNBYN is no longer authorized. Tap Connect again.":"Connect MUNBYN once to remember it.","info");
     return false;
   }
   report("Restoring your saved MUNBYN Bluetooth connection…");
   await openGatt(selected,{recover:true});return true;
 }catch(e){
   report("Automatic reconnect unsuccessful: "+(e?.message||"unknown error"),"warning");
   return false;
 }
}
if(typeof document!=="undefined"&&typeof document.addEventListener==="function"){
 document.addEventListener("visibilitychange",()=>{
   if(document.visibilityState==="visible"&&!manualStop&&!isPrinterConnected()&&savedId())void reconnectRememberedPrinter();
 });
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

function rowsOf(name,address){return [name,address?.line1,address?.line2,address?.cityStatePostal,address?.country].map(x=>String(x||"").trim()).filter(Boolean)}
// Native TSPL font 2 is 12 x 20 dots, substantially smaller than raster print jobs.
const textSubstitutions={"’":"'","‘":"'","–":"-","—":"-","“":'"',"”":'"',"œ":"oe","Œ":"OE","æ":"ae","Æ":"AE"};
function cleanText(value){
 return [...String(value)].map(ch=>{
  const n=ch.codePointAt(0);
  if(ch==='"'||ch==="\\"||ch==="\n"||ch==="\r")return " ";
  if((n>=32&&n<=126)||(n>=160&&n<=255))return ch;
  if(textSubstitutions[ch]!==undefined)return textSubstitutions[ch];
  throw Error("Unsupported address character "+ch+". Verify this address before printing.");
 }).join("").replace(/\s+/g," ").trim();
}
function codepage1252(value){
 const buf=new Uint8Array(value.length);
 for(let i=0;i<value.length;i++)buf[i]=value.charCodeAt(i);
 return buf;
}
function layoutLines(rows,maxChars){
 const out=[];
 for(const raw of rows){
  const words=cleanText(raw).split(/\s+/).filter(Boolean);
  let current="";
  for(const word of words){
   if(word.length>maxChars)throw Error("Address contains a word too long for the physical label: "+word);
   const next=current?current+" "+word:word;
   if(next.length>maxChars){out.push(current);current=word;}else current=next;
  }
  if(current)out.push(current);
 }
 return out;
}

export function layoutAddressCentered(lines,width,height,measure=(t,size)=>t.length*size*.53){
 const margin=18,headingHeight=34,gap=8;
 for(let size=28;size>=17;size--){
  const rows=[];let bad=false;
  for(const raw of lines){
   let current="";
   for(const word of String(raw).split(/\s+/).filter(Boolean)){
    if(measure(word,size)>width-2*margin){bad=true;break;}
    const next=current?current+" "+word:word;
    if(current&&measure(next,size)>width-2*margin){rows.push(current);current=word;}
    else current=next;
   }
   if(bad)break;
   if(current)rows.push(current);
  }
  if(bad)continue;
  const lineHeight=Math.ceil(size*1.18),total=headingHeight+gap+lineHeight*rows.length;
  if(!rows.length||total>height-2*margin)continue;
  // Center the address block while retaining left-aligned text.
  const widest=Math.max(measure("Ship from",26),measure("Ship to",26),...rows.map(x=>measure(x,size)));
  const x=Math.floor((width-widest)/2),y=Math.floor((height-total)/2);
  return {rows,size,lineHeight,headingHeight,gap,total,widest,x,y};
 }
 throw Error("Address does not fit on this label at a readable size. No labels sent.");
}
function rasterLabel(title,lines,w,h){
 const width=Math.round(w*DPI),height=Math.round(h*DPI);
 if(width<440||width>875||height<250||height>1259)throw Error("Unsupported label dimensions.");
 const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext("2d",{willReadFrequently:true});
 if(!ctx)throw Error("This browser cannot render thermal labels.");
 const info=layoutAddressCentered(lines,width,height,(text,size)=>{ctx.font=size+"px Arial";return ctx.measureText(text).width});
 ctx.fillStyle="white";ctx.fillRect(0,0,width,height);ctx.fillStyle="black";ctx.textBaseline="top";
 ctx.font="bold 26px Arial";ctx.fillText(title,info.x,info.y);
 ctx.font=info.size+"px Arial";
 let y=info.y+info.headingHeight+info.gap;
 for(const row of info.rows){ctx.fillText(row,info.x,y);y+=info.lineHeight;}
 return rgbaToBitmap(ctx.getImageData(0,0,width,height).data,width,height);
}
export function pagesForOrder(order,settings){
 const w=Number(settings.labelWidth)||2.25,h=Number(settings.labelHeight)||1.25;
 const from=rowsOf(settings.returnName,settings.returnAddress),to=rowsOf(order.shipTo?.name,order.shipTo);
 if(from.length<3||to.length<3)throw Error("Return or recipient address is incomplete. No labels sent.");
 return [rasterLabel("Ship from",from,w,h),rasterLabel("Ship to",to,w,h)];
}
export function testPage(settings){
 return rasterLabel("PIKO TEST",["Arial font test","Large centered text","Print alignment"],Number(settings.labelWidth)||2.25,Number(settings.labelHeight)||1.25);
}

export class BluetoothWriteTimeout extends Error {
 constructor(label,chunk){super("MUNBYN stopped responding while sending label "+label+" (packet "+chunk+"). Bluetooth connection reset. Check the paper before retrying.");this.name="BluetoothWriteTimeout"}
}
// A browser GATT promise can remain pending when the printer stops responding.
// Never issue another write after timeout on the old connection: disconnect it.
export async function writeChunkWithTimeout(characteristic,chunk,{timeoutMs=7000,label=1,packet=1,onTimeout=()=>{}}={}){
 let timer;
 const pending=Promise.resolve().then(()=>characteristic.writeValueWithResponse(chunk));
 // Observe a late rejection even when timeout has already won the race.
 pending.catch(()=>{});
 const timeout=new Promise((_,reject)=>{
  timer=setTimeout(()=>{
   try{onTimeout()}catch{}
   reject(new BluetoothWriteTimeout(label,packet));
  },timeoutMs);
 });
 try{return await Promise.race([pending,timeout]);}
 finally{clearTimeout(timer)}
}
export async function printPages(pages,settings){
 if(busy)throw Error("Another print job is active.");
 if(!isPrinterConnected())throw Error("Connect MUNBYN Bluetooth first.");
 if(!Array.isArray(pages)||pages.length<1||pages.length>50)throw Error("Select 1-25 orders.");
 // Pre-encode everything before sending the first label, avoiding partial
 // print jobs caused by a later label failing validation.
 const jobs=pages.map(page=>page.bytes||encodeTspl(page,Number(settings.labelWidth)||2.25,Number(settings.labelHeight)||1.25));
 busy=true;
 let written=0;
 try{
  for(let i=0;i<jobs.length;i++){
   const data=jobs[i],packetSize=20;
   const packetCount=Math.ceil(data.length/packetSize);
   report("Sending label "+(i+1)+" of "+jobs.length+" — 0%…");
   for(let pos=0;pos<data.length;pos+=packetSize){
    if(!isPrinterConnected())throw Error("MUNBYN disconnected during print. Check the paper before retrying.");
    const packet=Math.floor(pos/packetSize)+1;
    written++;
    await writeChunkWithTimeout(writer,data.subarray(pos,Math.min(pos+packetSize,data.length)),{
     timeoutMs:7000,label:i+1,packet,
     onTimeout:()=>{
      writer=null;
      try{device?.gatt?.disconnect()}catch{}
     }
    });
    // Update progress sparingly to avoid UI jank on Android.
    if(packet%30===0||packet===packetCount){
     report("Sending label "+(i+1)+" of "+jobs.length+" — "+Math.round(packet/packetCount*100)+"%…");
    }
    await delay(25);
   }
   report("Label "+(i+1)+" of "+jobs.length+" transmitted. Waiting for paper feed…");
   await delay(1300);
  }
  report("Both address labels transmitted. Verify the complete addresses on paper.","success");
 }catch(e){
  report((written?"Some data may already have printed; check the labels before retrying. ":"")+e.message,"error");
  throw e;
 }finally{
  busy=false;
 }
}
export async function printOrders(orders,settings){
 if(!orders.length||orders.length>25)throw Error("Select between 1 and 25 orders.");
 const pages=orders.flatMap(o=>pagesForOrder(o,settings)); // validate both labels before sending
 await printPages(pages,settings);
}
