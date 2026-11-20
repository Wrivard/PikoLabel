import test from "node:test";
import assert from "node:assert/strict";
import {planPackingItems,packingPdf} from "../pdf.mjs";
const settings={
 storeName:"Piko Cards",returnName:"Piko Cards",
 returnAddress:{line1:"123 Sample Road",line2:"",cityStatePostal:"Sorel-Tracy QC J3P 6E1",country:"Canada"},
 thankYouMessage:"Thanks for your purchase!"
};
const order=(n)=>({
 id:"SAMPLE-ORDER",displayId:"SAMPLE-ORDER",buyer:"buyer-123",
 createdAt:"2026-11-20",shipTo:{name:"Sample Buyer",line1:"PO Box 1234",cityStatePostal:"Indian Head SK S0G 2K0",country:"Canada"},
 items:Array.from({length:n},(_,i)=>({
  title:"Pokemon Card "+String(i+1).padStart(2,"0")+" 121/182 Rare Deck Exclusives Lightly Played",
  quantity:1,price:{value:"2.97",currency:"CAD"}
 })),
 total:{value:"124.74",currency:"CAD"},shippingCost:{value:"0",currency:"CAD"}
});
test("42 different card listings fit on one Letter page with no omissions",()=>{
 const o=order(42),layout=planPackingItems(o.items),pdf=packingPdf([o],settings);
 assert.equal(layout.count,42);
 assert.equal(layout.total,42);
 assert.equal(layout.laid.reduce((n,col)=>n+col.length,0),42);
 assert.ok(layout.columns>=2);
 const content=pdf.toString("latin1");
 assert.match(content,/\/MediaBox \[0 0 612\.00 792\.00\]/);
 assert.match(content,/\/Count 1/);
 for(const i of [1,12,24,35,42]){
   const title=o.items[i-1].title;
   assert.ok(content.includes(Buffer.from(title,"latin1").toString("hex").toUpperCase()),"missing "+title);
 }
});
test("one page is generated per eBay order, not per card",()=>{
 const p=packingPdf([order(42),order(2)],settings).toString("latin1");
 assert.match(p,/\/Count 2/);
});
test("very long listings refuse printing rather than silently dropping items",()=>{
 const tooBig=order(140);
 tooBig.items=tooBig.items.map((item)=>({...item,title:item.title+" with very long additional descriptive text"}));
 assert.throws(()=>packingPdf([tooBig],settings),/cannot fit|too much/i);
});
