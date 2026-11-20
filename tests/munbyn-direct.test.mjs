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
