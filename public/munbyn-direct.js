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
export function encodeTextLabel(title,lines,widthIn=2.25,heightIn=1.25){
 const w=Math.round(widthIn*DPI),h=Math.round(heightIn*DPI),m=20,top=17;
 if(w<440||w>875||h<250||h>1259)throw Error("Invalid thermal label dimensions");
 const rows=layoutLines(lines,Math.floor((w-2*m)/12));
 if(!rows.length)throw Error("Cannot print a blank address label.");
 if(top+33+rows.length*27>h-9)throw Error("Address has "+rows.length+" lines and does not fit "+widthIn+" x "+heightIn+" inches. No labels sent.");
 const cmds=[
  "SIZE "+(widthIn*25.4).toFixed(2)+" mm,"+(heightIn*25.4).toFixed(2)+" mm",
  "GAP 3 mm,0 mm","DIRECTION 0,0","REFERENCE 0,0","CODEPAGE 1252","CLS",
  'TEXT '+m+','+top+',"3",0,1,1,"'+cleanText(title)+'"'
 ];
 let y=top+33;
 for(const line of rows){cmds.push('TEXT '+m+','+y+',"2",0,1,1,"'+line+'"');y+=27;}
 cmds.push("PRINT 1,1");
 return {bytes:codepage1252(cmds.join("\r\n")+"\r\n"),lines:rows};
}
export function commandsForOrder(order,settings){
 const w=Number(settings.labelWidth)||2.25,h=Number(settings.labelHeight)||1.25;
 const from=rowsOf(settings.returnName,settings.returnAddress),to=rowsOf(order.shipTo?.name,order.shipTo);
 if(from.length<3)throw Error("Enter a complete return address in Business details.");
 if(to.length<3)throw Error("Recipient address is incomplete. Check the eBay order.");
 return [encodeTextLabel("Ship from",from,w,h),encodeTextLabel("Ship to",to,w,h)];
}
export function testPage(settings){
 return encodeTextLabel("PIKO TEST",["Bluetooth test","Check all lines","Check alignment"],Number(settings.labelWidth)||2.25,Number(settings.labelHeight)||1.25);
}
export async function printPages(pages,settings){
 if(busy)throw Error("Another print job is active.");
 if(!isPrinterConnected())throw Error("Connect MUNBYN Bluetooth first.");
 if(pages.length===0||pages.length>50)throw Error("Select 1-25 orders");
 busy=true;let attempted=false;
 try{
  for(let i=0;i<pages.length;i++){
   const data=pages[i].bytes||encodeTspl(pages[i],Number(settings.labelWidth)||2.25,Number(settings.labelHeight)||1.25);
   report("Sending label "+(i+1)+" of "+pages.length+"...");
   for(let pos=0;pos<data.length;pos+=64){
    if(!isPrinterConnected())throw Error("MUNBYN disconnected");
    attempted=true;
    await writer.writeValueWithResponse(data.subarray(pos,Math.min(pos+64,data.length)));
    await delay(32);
   }
   await delay(1300);
  }
  report(pages.length+" label(s) transmitted. Confirm each address line printed.","success");
 }catch(e){report((attempted?"Part of the job may have printed; check paper before retrying. ":"")+e.message,"error");throw e}
 finally{busy=false}
}
export async function printOrders(orders,settings){
 if(!orders.length||orders.length>25)throw Error("Select between 1 and 25 orders.");
 const pages=orders.flatMap(o=>commandsForOrder(o,settings)); // validate every label before sending
 await printPages(pages,settings);
}
