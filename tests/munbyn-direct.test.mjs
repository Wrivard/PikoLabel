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


test("original Arial layout keeps its previous 28px size for normal addresses",async()=>{
 const {layoutAddress}=await import("../public/munbyn-direct.js");
 const l=layoutAddress(["William Rivard","340 rue huard","Sorel-Tracy, QC J3P 6E1","Canada"],457,254);
 assert.equal(l.size,28);
 assert.ok(l.rows.join(" ").includes("J3P 6E1"));
});
test("long addresses must fit before a label is sent",async()=>{
 const {layoutAddress}=await import("../public/munbyn-direct.js");
 assert.throws(()=>layoutAddress(Array.from({length:20},()=> "Some lengthy address line"),457,254),/does not fit/);
});

test("bitmap encoder omits white rows and columns without dropping text pixels",async()=>{
 const {encodeTspl}=await import("../public/munbyn-direct.js");
 const width=58,height=90,bytes=new Uint8Array(width*height).fill(255);
 for(let y=10;y<15;y++)for(let x=5;x<11;x++)bytes[y*width+x]=0;
 for(let y=60;y<64;y++)for(let x=19;x<28;x++)bytes[y*width+x]=0;
 const command=encodeTspl({bytes,stride:width,height},2.25,1.25);
 const string=new TextDecoder("latin1").decode(command);
 assert.ok(string.includes("BITMAP 40,10,6,5,0,"));
 assert.ok(string.includes("BITMAP 152,60,9,4,0,"));
 assert.ok(string.endsWith("PRINT 1,1\r\n"));
 assert.ok(command.length<450,"should omit large blank bitmap regions");
});
test("blank bitmap still emits one valid label print command",async()=>{
 const {encodeTspl}=await import("../public/munbyn-direct.js");
 const output=encodeTspl({bytes:new Uint8Array(58*40).fill(255),stride:58,height:40},2.25,1.25);
 const str=new TextDecoder().decode(output);
 assert.ok(!str.includes("BITMAP"));
 assert.ok(str.includes("PRINT 1,1"));
});
