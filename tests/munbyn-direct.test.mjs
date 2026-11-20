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
