import test from "node:test";
import assert from "node:assert/strict";

test("startup reaches order list and eBay connection after loading saved settings",async()=>{
 const nodes=new Map();
 const element=id=>{
  if(!nodes.has(id)){
   const classes=new Set(["hidden"]);
   nodes.set(id,{
    id,value:"",checked:false,textContent:"",innerHTML:"",disabled:false,dataset:{},
    classList:{add(x){classes.add(x)},remove(x){classes.delete(x)},toggle(x,force){if(force===true)classes.add(x);else if(force===false)classes.delete(x);else classes.has(x)?classes.delete(x):classes.add(x)},contains(x){return classes.has(x)}},
    addEventListener(){},replaceChildren(){},setAttribute(){},removeAttribute(){},style:{}
   });
  }
  return nodes.get(id);
 };
 globalThis.document={getElementById:element,querySelectorAll:()=>[]};
 globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
 const sample={id:"TEST-ORDER",createdAt:"2026-11-20",buyer:"test",shipTo:{name:"Test Customer",line1:"Example Road",cityStatePostal:"Toronto ON",country:"Canada"},items:[],total:{value:"0",currency:"CAD"}};
 const baseSettings={storeName:"PIKO CARDS",returnName:"Piko Cards",returnAddress:{line1:"1 Example Road",line2:"",cityStatePostal:"Sorel QC",country:"Canada"},thankYouMessage:"Thanks",labelWidth:2.25,labelHeight:1.25,labelFont:10,labelGap:0,labelBorder:false,labelProfile:"word"};
 globalThis.fetch=async input=>({
  ok:true,
  headers:{get:()=> "application/json"},
  json:async()=>input.includes("bootstrap")?{authenticated:true,rememberedBrowser:true,ebayConfigured:true,connected:false,settings:baseSettings,settingsSavedAt:0}:{orders:[sample],demo:true}
 });
 await import("../public/app.js");
 await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(element("count").textContent,1,"orders should render");
 assert.match(element("connect").innerHTML,/Connect eBay/,"eBay connect control should render");
 assert.equal(element("app").classList.contains("hidden"),false,"authenticated workspace should be visible");
 assert.equal(element("toast").textContent,"","startup should not show an error");
});
