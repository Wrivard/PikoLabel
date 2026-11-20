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

test("native TSPL contains full recipient address and no bulky bitmap",async()=>{
 const {encodeTextLabel}=await import("../public/munbyn-direct.js");
 const label=encodeTextLabel("Ship to",["Sample Buyer","PO Box 1256","Calgary, AB T2A 2B2","Canada"]);
 const str=Array.from(label.bytes,x=>String.fromCharCode(x)).join("");
 for(const row of ["Sample Buyer","PO Box 1256","Calgary, AB T2A 2B2","Canada"])assert.ok(str.includes(row));
 assert.ok(str.includes("CODEPAGE 1252"));
 assert.ok(!str.includes("BITMAP"));
 assert.ok(label.bytes.length<1300);
 assert.ok(str.endsWith("PRINT 1,1\r\n"));
});
test("address that cannot fit fails before sending",async()=>{
 const {encodeTextLabel}=await import("../public/munbyn-direct.js");
 assert.throws(()=>encodeTextLabel("Ship to",Array.from({length:11},(_,i)=>"Line "+i)),/does not fit/);
});
test("native printer text preserves accented names in code page 1252",async()=>{
 const {encodeTextLabel}=await import("../public/munbyn-direct.js");
 const label=encodeTextLabel("Ship to",["Élodie","Montréal QC","Canada"]);
 assert.ok(label.bytes.includes(201));assert.ok(label.bytes.includes(233));
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
