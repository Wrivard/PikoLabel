import test from "node:test";
import assert from "node:assert/strict";
import {route} from "../lib/api.mjs";

process.env.APP_PASSWORD="test-password-long-enough";
process.env.APP_SECRET="test-secret-is-at-least-32-characters-long";
// No eBay credentials needed to verify local browser authentication.
delete process.env.EBAY_CLIENT_ID;
delete process.env.EBAY_CLIENT_SECRET;
delete process.env.EBAY_RUNAME;

async function request(action,{method="GET",cookie,body}={}){
 const headers={host:"pikolabel.vercel.app","x-forwarded-proto":"https",...(cookie?{cookie}: {})};
 const req={method,url:"/api/"+action,headers,...(body?{body}: {})};
 const result={headers:new Map(),statusCode:200};
 const res={
   getHeader(name){return result.headers.get(name.toLowerCase());},
   setHeader(name,value){result.headers.set(name.toLowerCase(),value);},
   end(value){result.body=value;},
   set statusCode(value){result.statusCode=value;},
   get statusCode(){return result.statusCode;}
 };
 await route(req,res,action);
 result.json=JSON.parse(String(result.body||"{}"));
 result.setCookies=result.headers.get("set-cookie")||[];
 result.cookie=result.setCookies.map(x=>x.split(";")[0]).join("; ");
 return result;
}

test("remember browser: secure, HTTP-only 90-day cookie and persistent login",async()=>{
 const login=await request("login",{method:"POST",body:{password:process.env.APP_PASSWORD,remember:true}});
 assert.equal(login.json.ok,true);
 assert.equal(login.setCookies.length,1);
 const set=login.setCookies[0];
 for(const attribute of ["HttpOnly","Secure","SameSite=Lax","Path=/api","Max-Age=7776000"])assert.ok(set.includes(attribute),attribute);
 assert.equal(set.includes(process.env.APP_PASSWORD),false,"password must never be stored in cookie");
 const bootstrap=await request("bootstrap",{cookie:login.cookie});
 assert.equal(bootstrap.json.authenticated,true);
 assert.equal(bootstrap.json.rememberedBrowser,true);
 assert.equal(bootstrap.setCookies.length,0,"do not issue unnecessary cookies on every request");
});

test("remembered browser session is renewed when it approaches expiration",async()=>{
 const login=await request("login",{method:"POST",body:{password:process.env.APP_PASSWORD,remember:true}});
 const now=Date.now;
 const baseline=now();
 Date.now=()=>baseline+50*86400000;
 try{
  const bootstrap=await request("bootstrap",{cookie:login.cookie});
  assert.equal(bootstrap.json.authenticated,true);
  assert.equal(bootstrap.setCookies.length,1,"renew cookie after 50 days");
  const renewed=await request("bootstrap",{cookie:bootstrap.cookie});
  assert.equal(renewed.json.authenticated,true);
  assert.equal(renewed.setCookies.length,0,"newly renewed cookie should not renew again");
 }finally{Date.now=now;}
});

test("unchecked remember option uses temporary browser-session cookie",async()=>{
 const login=await request("login",{method:"POST",body:{password:process.env.APP_PASSWORD,remember:false}});
 assert.equal(login.json.ok,true);
 assert.equal(login.setCookies[0].includes("Max-Age"),false);
 const bootstrap=await request("bootstrap",{cookie:login.cookie});
 assert.equal(bootstrap.json.authenticated,true);
 assert.equal(bootstrap.json.rememberedBrowser,false);
});

test("signing out clears this browser's session",async()=>{
 const login=await request("login",{method:"POST",body:{password:process.env.APP_PASSWORD,remember:true}});
 const logout=await request("logout",{method:"POST",cookie:login.cookie});
 assert.equal(logout.json.ok,true);
 assert.ok(logout.setCookies[0].includes("Max-Age=0"));
 const bootstrap=await request("bootstrap",{cookie:logout.cookie});
 assert.equal(bootstrap.json.authenticated,false);
});

test("wrong password cannot create a remembered session",async()=>{
 const login=await request("login",{method:"POST",body:{password:"wrong",remember:true}});
 assert.equal(login.statusCode,401);
 assert.equal(login.setCookies.length,0);
});

test("business details save to an encrypted cookie and rehydrate on reload",async()=>{
 const login=await request("login",{method:"POST",body:{password:process.env.APP_PASSWORD,remember:true}});
 const profile={
   storeName:"Piko Cards Shop",returnName:"Seller Name",
   returnAddress:{line1:"123 Example Road",line2:"Unit 4",cityStatePostal:"Sorel-Tracy QC J3P 1A1",country:"Canada"},
   thankYouMessage:"Thanks for supporting our store!",
   labelWidth:2.25,labelHeight:1.25,labelFont:10,labelProfile:"word"
 };
 const saved=await request("settings",{method:"POST",cookie:login.cookie,body:{settings:profile}});
 assert.equal(saved.json.ok,true);
 assert.equal(saved.json.settings.storeName,profile.storeName);
 const set=saved.setCookies.find(x=>x.startsWith("piko_profile="));
 assert.ok(set);
 for(const attribute of ["HttpOnly","Secure","Max-Age=31536000"])assert.ok(set.includes(attribute),attribute);
 assert.equal(set.includes(profile.returnAddress.line1),false);
 const cookies=login.cookie+"; "+saved.cookie;
 const reboot=await request("bootstrap",{cookie:cookies});
 assert.equal(reboot.json.authenticated,true);
 assert.equal(reboot.json.settings.returnAddress.cityStatePostal,profile.returnAddress.cityStatePostal);
 assert.equal(reboot.json.settings.thankYouMessage,profile.thankYouMessage);
 assert.ok(reboot.json.settingsSavedAt>0);
 const get=await request("settings",{cookie:cookies});
 assert.equal(get.json.settings.storeName,profile.storeName);
});
test("business details are protected from unauthenticated requests",async()=>{
 const login=await request("login",{method:"POST",body:{password:process.env.APP_PASSWORD,remember:true}});
 const saved=await request("settings",{method:"POST",cookie:login.cookie,body:{settings:{storeName:"Private Store"}}});
 const anonymous=await request("bootstrap",{cookie:saved.cookie});
 assert.equal(anonymous.json.authenticated,false);
 assert.notEqual(anonymous.json.settings.storeName,"Private Store");
 const forbidden=await request("settings",{method:"POST",body:{settings:{storeName:"Unauthorized"}}});
 assert.equal(forbidden.statusCode,401);
});
test("settings save clamps numerical values and ignores unrelated properties",async()=>{
 const login=await request("login",{method:"POST",body:{password:process.env.APP_PASSWORD,remember:true}});
 const saved=await request("settings",{method:"POST",cookie:login.cookie,body:{settings:{storeName:"Test",unknown:"private",labelWidth:15}}});
 assert.equal(saved.json.settings.unknown,undefined);
 assert.equal(saved.json.settings.labelWidth,4.3);
});
