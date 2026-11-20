import test from "node:test";
import assert from "node:assert/strict";
import {rgbaToBitmap,encodeTspl} from "../public/munbyn-direct.js";
test("bitmap uses TSPL white=1 and black=0, padded white",()=>{
 const data=new Uint8Array(9*4).fill(255);
 data[0]=0;data[1]=0;data[2]=0;
 const bitmap=rgbaToBitmap(data,9,1);
 assert.equal(bitmap.stride,2);
 assert.deepEqual([...bitmap.bytes],[0x7f,0xff]);
});
test("TSPL stream has exact physical size, bitmap payload, and one print",()=>{
 const bitmap={bytes:new Uint8Array(4).fill(255),stride:2,height:2};
 const command=encodeTspl(bitmap,2.25,1.25);
 const text=new TextDecoder().decode(command);
 assert.ok(text.includes("SIZE 57.15 mm,31.75 mm"));
 assert.ok(text.includes("BITMAP 0,0,2,2,0,"));
 assert.ok(text.endsWith("PRINT 1,1\r\n"));
});
test("invalid bitmaps are rejected",()=>{
 assert.throws(()=>rgbaToBitmap(new Uint8Array(0),8,8),/Invalid/);
});

test("previously authorized MUNBYN reconnects after refresh without picker",async()=>{
 const mod=await import("../public/munbyn-direct.js?restore-test");
 const oldN=globalThis.navigator,oldS=globalThis.localStorage;
 const store=new Map([["piko-munbyn-device-id","remembered-id"]]),calls=[];
 const characteristic={properties:{write:true},async writeValueWithResponse(){}};
 const dev={id:"remembered-id",name:"MUNBYN ITPP130B",gatt:{
   connected:false,async connect(){this.connected=true;return this;},
   async getPrimaryService(){return {async getCharacteristic(){return characteristic}};},
   disconnect(){this.connected=false;}
 },addEventListener(){}};
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{bluetooth:{
   async getDevices(){calls.push("getDevices");return [dev]},
   async requestDevice(){calls.push("picker");throw Error("unexpected picker")}
 }}});
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 try{
   assert.equal(await mod.reconnectRememberedPrinter(),true);
   assert.equal(mod.isPrinterConnected(),true);
   assert.deepEqual(calls,["getDevices"]);
   mod.disconnectPrinter();
   assert.equal(store.has("piko-munbyn-device-id"),false);
   assert.equal(await mod.reconnectRememberedPrinter(),false);
 }finally{Object.defineProperty(globalThis,"navigator",{configurable:true,value:oldN});globalThis.localStorage=oldS}
});
test("unsupported getDevices fails without crashing the app",async()=>{
 const mod=await import("../public/munbyn-direct.js?unsupported");
 const oldN=globalThis.navigator;
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{bluetooth:{requestDevice(){}}}});
 try{assert.equal(await mod.reconnectRememberedPrinter(),false)}
 finally{Object.defineProperty(globalThis,"navigator",{configurable:true,value:oldN})}
});
test("revoked permission never triggers unexpected device picker",async()=>{
 const mod=await import("../public/munbyn-direct.js?revoked");
 const oldN=globalThis.navigator,oldS=globalThis.localStorage;
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{bluetooth:{
   async getDevices(){return []},async requestDevice(){throw Error("unexpected picker")}
 }}});
 globalThis.localStorage={getItem:()=> "remembered-id",setItem(){},removeItem(){}};
 try{assert.equal(await mod.reconnectRememberedPrinter(),false)}
 finally{Object.defineProperty(globalThis,"navigator",{configurable:true,value:oldN});globalThis.localStorage=oldS}
});

test("reconnect reuses a cached device within same tab when getDevices is unavailable",async()=>{
 const mod=await import("../public/munbyn-direct.js?same-tab");
 const oldN=globalThis.navigator,oldS=globalThis.localStorage;
 const store=new Map(),events=new Map();
 let calls=0;
 const characteristic={properties:{write:true},async writeValueWithResponse(){}};
 const dev={id:"cached-id",name:"MUNBYN",gatt:{
   connected:false,async connect(){this.connected=true;calls++;return this},
   async getPrimaryService(){return {async getCharacteristic(){return characteristic}}},
   disconnect(){this.connected=false}
 },addEventListener:(name,cb)=>events.set(name,cb)};
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{bluetooth:{async requestDevice(){return dev}}}});
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 try{
   await mod.connectPrinter();
   dev.gatt.connected=false;
   events.get("gattserverdisconnected")?.();
   assert.equal(await mod.reconnectRememberedPrinter(),true);
   assert.equal(calls,2);
   assert.equal(mod.isPrinterConnected(),true);
 }finally{Object.defineProperty(globalThis,"navigator",{configurable:true,value:oldN});globalThis.localStorage=oldS}
});

test("out-of-range error is recovered using an advertisement and retry",async()=>{
 const mod=await import("../public/munbyn-direct.js?range-retry");
 const oldN=globalThis.navigator,oldS=globalThis.localStorage;
 const store=new Map([["piko-munbyn-device-id","m1"]]),handlers=new Map();
 let calls=0,scans=0;
 const characteristic={properties:{write:true},async writeValueWithResponse(){}};
 const dev={id:"m1",name:"MUNBYN ITPP130B",gatt:{
   connected:false,
   async connect(){
     calls++;
     if(calls===1)throw new Error("Bluetooth Device is no longer in range.");
     this.connected=true;return this;
   },
   async getPrimaryService(){return {async getCharacteristic(){return characteristic}}},
   disconnect(){this.connected=false}
 },addEventListener(n,fn){handlers.set(n,fn)},removeEventListener(n){handlers.delete(n)},
 async watchAdvertisements(){
   scans++;
   queueMicrotask(()=>handlers.get("advertisementreceived")?.());
 }};
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{bluetooth:{async getDevices(){return [dev]}}}});
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 try{
   assert.equal(await mod.reconnectRememberedPrinter(),true);
   assert.equal(mod.isPrinterConnected(),true);
   assert.equal(calls,2);
   assert.equal(scans,1);
 }finally{
   Object.defineProperty(globalThis,"navigator",{configurable:true,value:oldN});
   globalThis.localStorage=oldS;
 }
});

test("original Arial layout stays large and centers across the label",async()=>{
 const {layoutAddressCentered}=await import("../public/munbyn-direct.js");
 const result=layoutAddressCentered(["William Rivard","340 rue huard","Sorel-Tracy QC J3P 6E1","Canada"],457,254);
 assert.equal(result.size,28);
 assert.ok(result.x>=18);
 assert.ok(result.y>=18);
 assert.ok(Math.abs(result.x+result.widest/2-457/2)<=1);
 assert.ok(Math.abs(result.y+result.total/2-254/2)<=1);
});
test("long address preserves every word and fits on the paper",async()=>{
 const {layoutAddressCentered}=await import("../public/munbyn-direct.js");
 const lines=["Justin Ritchie","PO Box 1256","Indian Head Saskatchewan S0G 2K0","Canada"];
 const l=layoutAddressCentered(lines,457,254);
 assert.equal(l.rows.join(" "),lines.join(" "));
 assert.ok(l.y+l.total<=254-18);
});
test("oversized address fails instead of clipping lines",async()=>{
 const {layoutAddressCentered}=await import("../public/munbyn-direct.js");
 assert.throws(()=>layoutAddressCentered(Array.from({length:18},()=> "Long extra address line"),457,254),/does not fit/);
});

test("stalled Bluetooth writes time out instead of hanging forever",async()=>{
 const {writeChunkWithTimeout,BluetoothWriteTimeout}=await import("../public/munbyn-direct.js");
 let reset=false;
 await assert.rejects(writeChunkWithTimeout({writeValueWithResponse(){return new Promise(()=>{})}},new Uint8Array([1]),{
  timeoutMs:25,label:1,packet:2,onTimeout(){reset=true}
 }),BluetoothWriteTimeout);
 assert.equal(reset,true);
});
test("successful write does not trigger timeout",async()=>{
 const {writeChunkWithTimeout}=await import("../public/munbyn-direct.js");
 let reset=false;
 await writeChunkWithTimeout({async writeValueWithResponse(){}},new Uint8Array([1]),{timeoutMs:100,onTimeout(){reset=true}});
 assert.equal(reset,false);
});

test("lightweight centered TSPL label contains the whole address",async()=>{
 const {encodeReliableLabel}=await import("../public/munbyn-direct.js");
 const label=encodeReliableLabel("Ship from",["William Rivard","340 rue huard","Sorel-Tracy QC J3P 6E1","Canada"]);
 const str=Array.from(label.bytes,b=>String.fromCharCode(b)).join("");
 for(const item of ["Ship from","William Rivard","340 rue huard","Sorel-Tracy QC J3P 6E1","Canada"])assert.ok(str.includes(item),item);
 assert.ok(label.left>=18&&label.top>=18);
 assert.ok(label.bytes.length<1000);
 assert.ok(str.endsWith("PRINT 1,1\r\n"));
});
test("both labels are generated as lightweight independent jobs",async()=>{
 const {reliablePagesForOrder}=await import("../public/munbyn-direct.js");
 const order={shipTo:{name:"Justin Ritchie",line1:"PO Box 1256",cityStatePostal:"Indian Head SK S0G 2K0",country:"Canada"}};
 const settings={labelWidth:2.25,labelHeight:1.25,returnName:"William Rivard",returnAddress:{line1:"340 rue huard",cityStatePostal:"Sorel-Tracy QC J3P 6E1",country:"Canada"}};
 const pages=reliablePagesForOrder(order,settings);
 assert.equal(pages.length,2);
 for(const page of pages)assert.ok(page.bytes.length<1000);
 const recipient=Array.from(pages[1].bytes,b=>String.fromCharCode(b)).join("");
 assert.ok(recipient.includes("Justin Ritchie"));
 assert.ok(recipient.includes("PO Box 1256"));
});


test("compact serif raster test omits blank rows and retains ink",async()=>{
 const {encodeInkOnlyTspl}=await import("../public/munbyn-direct.js");
 const data=new Uint8Array(58*100).fill(255);
 for(let y=12;y<18;y++)for(let x=9;x<20;x++)data[y*58+x]=0;
 const cmd=encodeInkOnlyTspl({bytes:data,stride:58,height:100},2.25,1.25);
 const body=new TextDecoder("latin1").decode(cmd);
 assert.ok(body.includes("BITMAP 72,12,11,6,0,"));
 assert.ok(body.endsWith("PRINT 1,1\r\n"));
 assert.ok(cmd.length<300);
});

test("main order printing and sample use the same Word-style raster renderer",async()=>{
 const module=await import("../public/munbyn-direct.js");
 const prevDocument=globalThis.document;
 const fonts=[],drawn=[];
 const context={
  font:"",fillStyle:"",textBaseline:"",
  fillRect(){},fillText(text){drawn.push({text,font:this.font})},
  measureText(text){fonts.push(this.font);return {width:String(text).length*12}},
  getImageData(x,y,w,h){
    const data=new Uint8ClampedArray(w*h*4);
    data.fill(255);data[0]=0;data[1]=0;data[2]=0;return {data};
  }
 };
 globalThis.document={createElement(){return {getContext(){return context}}}};
 const settings={labelWidth:2.25,labelHeight:1.25,returnName:"William Rivard",
   returnAddress:{line1:"340 rue huard",cityStatePostal:"Sorel-Tracy QC J3P 6E1",country:"Canada"}};
 const order={shipTo:{name:"Justin Ritchie",line1:"PO Box 1256",cityStatePostal:"Indian Head SK S0G 2K0",country:"Canada"}};
 try{
  const sample=module.wordStyleFontTest(settings);
  const labels=module.wordStylePagesForOrder(order,settings);
  assert.equal(sample.renderer,"word-serif");
  assert.equal(labels.length,2);
  assert.ok(labels.every(label=>label.renderer===sample.renderer));
  assert.ok(drawn.some(x=>x.text==="Justin Ritchie"));
  assert.ok(drawn.some(x=>x.text==="William Rivard"));
  assert.ok(drawn.every(x=>x.font.includes("Times New Roman")));
 }finally{globalThis.document=prevDocument}
});

test("thermal serif edges are preserved at 203 DPI without changing original font",()=>{
 const samples=[255,225,207,190,160,30];
 const data=new Uint8ClampedArray(samples.length*4);
 for(let i=0;i<samples.length;i++){data[i*4]=samples[i];data[i*4+1]=samples[i];data[i*4+2]=samples[i];data[i*4+3]=255;}
 const image=rgbaToBitmap(data,samples.length,1);
 assert.equal(image.stride,1);
 // Pixels 207, 190, 160 and 30 must become ink; paper white remains white.
 assert.equal(image.bytes[0],0b11000011);
});
