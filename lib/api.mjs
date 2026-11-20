import crypto from "node:crypto";
import {handleBooks} from "./books.mjs";
import {labelsPdf,packingPdf,calibrationPdf} from "../pdf.mjs";
const demo=[{id:"DEMO-1001",displayId:"DEMO-1001",buyer:"collector_north",createdAt:"2026-11-19",shipTo:{name:"Alex Morgan",line1:"124 Example Street",cityStatePostal:"Ottawa, ON K1A 0B1",country:"Canada"},items:[{title:"Pokémon reverse holo cards",quantity:3,price:{value:"2.97",currency:"CAD"}}],total:{value:"8.91",currency:"CAD"}} ,{id:"DEMO-1002",displayId:"DEMO-1002",buyer:"card_fan22",createdAt:"2026-11-18",shipTo:{name:"Jamie Taylor",line1:"48 Sample Avenue",line2:"Unit 4",cityStatePostal:"Montréal, QC H2X 1Y4",country:"Canada"},items:[{title:"Pokémon 151 Gengar Reverse Holo",quantity:1,price:{value:"18.50",currency:"CAD"}}],total:{value:"18.50",currency:"CAD"}}];
const def={storeName:"PIKO CARDS",returnName:"Piko Cards",returnAddress:{line1:"",line2:"",cityStatePostal:"",country:"Canada"},thankYouMessage:"Thanks for your purchase! I hope you love it!",labelWidth:2.25,labelHeight:1.25,labelFont:10,labelMargin:.14,labelGap:0,labelBorder:false,packingPrinter:"Canon",labelPrinter:"MUNBYN 130B"};
const env=()=>({password:process.env.APP_PASSWORD||"",secret:process.env.APP_SECRET||"",id:process.env.EBAY_CLIENT_ID||"",key:process.env.EBAY_CLIENT_SECRET||"",ru:process.env.EBAY_RUNAME||"",sandbox:process.env.EBAY_ENVIRONMENT==="sandbox"});
const out=(r,data,status=200)=>{r.statusCode=status;r.setHeader("Cache-Control","private, no-store");r.setHeader("Content-Type","application/json");r.end(JSON.stringify(data));};
const cookie=req=>Object.fromEntries((req.headers.cookie||"").split(";").map(x=>{let i=x.indexOf("=");return i<0?["",""]:[x.slice(0,i).trim(),decodeURIComponent(x.slice(i+1).trim())]}));
const equal=(a,b)=>{let x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const digest=s=>crypto.createHash("sha256").update(s).digest();
const encrypted=(v,secret)=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",digest(secret),iv),buf=Buffer.concat([c.update(JSON.stringify(v)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),buf]).toString("base64url")};
const decrypted=(v,secret)=>{try{if(!v||!secret)return null;let b=Buffer.from(v,"base64url"),c=crypto.createDecipheriv("aes-256-gcm",digest(secret),b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString())}catch{return null}};
// A remembered browser receives an encrypted HTTP-only cookie, never the password.
const REMEMBER_SECONDS=90*86400;
const SHORT_SESSION_SECONDS=12*3600;
const RENEW_IF_LESS_THAN_MS=45*86400000;
function setCookie(req,res,name,value,maxAge){
 const prev=res.getHeader("Set-Cookie")||[];
 const life=maxAge===null?"":"; Max-Age="+maxAge;
 res.setHeader("Set-Cookie",[...prev,name+"="+encodeURIComponent(value)+"; Path=/api; HttpOnly; SameSite=Lax"+life+(process.env.VERCEL||req.headers["x-forwarded-proto"]==="https"?"; Secure":"")]);
}
const tokenUrl=c=>(c.sandbox?"https://api.sandbox.ebay.com":"https://api.ebay.com");
async function token(c,params){const r=await fetch(tokenUrl(c)+"/identity/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+Buffer.from(c.id+":"+c.key).toString("base64"),"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});const j=await r.json();if(!r.ok)throw Error(j.error_description||j.error||"eBay authorization failed");return j}
const scope="https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";
const configured=c=>Boolean(c.id&&c.key&&c.ru);
const authorized=(req,c)=>!c.password||decrypted(cookie(req).piko_session,c.secret)?.exp>Date.now();
function validSettings(input){
 const s=input&&typeof input==="object"&&!Array.isArray(input)?input:{};
 const d={...def};
 for(const k of ["storeName","returnName","thankYouMessage","packingPrinter","labelPrinter"])
   d[k]=String(s[k]??def[k]).slice(0,k==="thankYouMessage"?300:150);
 d.returnAddress={...def.returnAddress};
 for(const k of Object.keys(d.returnAddress))
   d.returnAddress[k]=String(s.returnAddress?.[k]??def.returnAddress[k]??"").slice(0,150);
 for(const [k,min,max] of [["labelWidth",2.2,4.3],["labelHeight",1.25,6.2],["labelFont",5.5,12],["labelGap",0,.5]]){
   const n=Number(s[k]);d[k]=Number.isFinite(n)?Math.min(max,Math.max(min,n)):def[k];
 }
 const margin=Number(s.labelMargin);
 d.labelMargin=Number.isFinite(margin)?Math.min(.4,Math.max(0,margin)):def.labelMargin;
 d.labelBorder=s.labelBorder===true;
 d.labelProfile=["word","standard","custom"].includes(s.labelProfile)?s.labelProfile:"word";
 return d;
}
function profileFor(req,c){
 const saved=decrypted(cookie(req).piko_profile,c.secret);
 return saved?.settings&&Number.isFinite(Number(saved.savedAt))
   ? {settings:validSettings(saved.settings),savedAt:Number(saved.savedAt)} : null;
}

async function body(req){if(req.body&&typeof req.body==="object")return req.body;let s="";for await(let chunk of req){s+=chunk.toString();if(s.length>250000)throw Error("Request too large")}return JSON.parse(s||"{}")}
function normalize(o){const step=(o.fulfillmentStartInstructions||[]).find(x=>x.shippingStep?.shipTo)?.shippingStep?.shipTo||{},a=step.contactAddress||{};return {id:o.orderId,displayId:o.legacyOrderId||o.orderId,buyer:o.buyer?.username||"Buyer",createdAt:o.creationDate,status:o.orderFulfillmentStatus,shipTo:{name:step.fullName||"",line1:a.addressLine1||"",line2:a.addressLine2||"",cityStatePostal:[a.city,a.stateOrProvince].filter(Boolean).join(", ")+(a.postalCode?" "+a.postalCode:""),country:a.countryCode==="CA"?"Canada":a.countryCode||""},items:(o.lineItems||[]).map(x=>({title:x.title||"Item",quantity:x.quantity||1,price:x.lineItemCost||null})),shippingCost:o.pricingSummary?.deliveryCost,total:o.pricingSummary?.total}}
async function orders(req,res,c){const saved=decrypted(cookie(req).piko_ebay,c.secret);if(!saved?.refresh_token)return demo;const t=await token(c,{grant_type:"refresh_token",refresh_token:saved.refresh_token,scope});if(t.refresh_token)setCookie(req,res,"piko_ebay",encrypted({refresh_token:t.refresh_token},c.secret),180*86400);const list=[];for(let offset=0;offset<300;offset+=100){let url=new URL(tokenUrl(c)+"/sell/fulfillment/v1/order");url.searchParams.set("filter","orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");url.searchParams.set("limit","100");url.searchParams.set("offset",String(offset));const r=await fetch(url,{headers:{Authorization:"Bearer "+t.access_token,Accept:"application/json"}}),j=await r.json();if(!r.ok)throw Error(j.errors?.[0]?.message||"Unable to fetch eBay orders");list.push(...(j.orders||[]).filter(x=>x.orderFulfillmentStatus==="NOT_STARTED"&&x.cancelStatus?.cancelState!=="CANCELED").map(normalize));if((j.orders||[]).length<100)break}return list}
export async function route(req,res,action){try{const c=env();if(configured(c)&&(c.password.length<12||c.secret.length<32))throw Error("Before connecting eBay set APP_PASSWORD (12+ characters) and APP_SECRET (32+ characters).");if(c.password&&c.secret.length<32)throw Error("APP_SECRET must have 32+ characters.");const u=new URL(req.url,"https://"+req.headers.host);
if(action==="login"){
 if(req.method!=="POST")return out(res,{error:"POST required"},405);
 if(!c.password)return out(res,{ok:true});
 const credentials=await body(req);
 if(!equal(credentials.password,c.password))return out(res,{error:"Incorrect password"},401);
 const remember=credentials.remember===true;
 const seconds=remember?REMEMBER_SECONDS:SHORT_SESSION_SECONDS;
 setCookie(req,res,"piko_session",encrypted({exp:Date.now()+seconds*1000,remember},c.secret),remember?seconds:null);
 return out(res,{ok:true});
}
if(action==="bootstrap"){
 const session=decrypted(cookie(req).piko_session,c.secret);
 const authenticated=!c.password||Number(session?.exp)>Date.now();
 const rememberedBrowser=!!(c.password&&authenticated&&session?.remember!==false);
 // Upgrade still-valid original 7-day cookies; renew remembered sessions
 // only near expiry, avoiding a Set-Cookie header on every request.
 if(rememberedBrowser&&session.exp-Date.now()<RENEW_IF_LESS_THAN_MS){
   setCookie(req,res,"piko_session",encrypted({exp:Date.now()+REMEMBER_SECONDS*1000,remember:true},c.secret),REMEMBER_SECONDS);
 }
 const saved=authenticated?profileFor(req,c):null;
 return out(res,{authenticated,passwordRequired:!!c.password,rememberedBrowser,ebayConfigured:configured(c),connected:!!decrypted(cookie(req).piko_ebay,c.secret),settings:saved?.settings??def,settingsSavedAt:saved?.savedAt??0});
}
if(!authorized(req,c))return out(res,{error:"Sign in required"},401);
if(action.startsWith("books-")){
 if(!c.password||!c.secret)return out(res,{error:"Secure Piko login must be configured before using financial records."},503);
 return handleBooks(req,res,action.slice(6));
}
if(action==="logout"){setCookie(req,res,"piko_session","",0);return out(res,{ok:true})}
if(action==="disconnect"){setCookie(req,res,"piko_ebay","",0);return out(res,{ok:true})}
if(action==="orders")return out(res,{orders:await orders(req,res,c),demo:!decrypted(cookie(req).piko_ebay,c.secret)});
if(action==="settings"){
 if(req.method==="GET"){const saved=profileFor(req,c);return out(res,{settings:saved?.settings??def,savedAt:saved?.savedAt??0})}
 if(req.method!=="POST")return out(res,{error:"GET or POST required"},405);
 if(c.secret.length<32)return out(res,{error:"APP_SECRET is required to securely save business details."},400);
 const b=await body(req),settings=validSettings(b.settings??b),savedAt=Date.now();
 const value=encrypted({settings,savedAt},c.secret);
 if(value.length>3200)return out(res,{error:"Settings too large to save"},413);
 setCookie(req,res,"piko_profile",value,365*86400);
 return out(res,{ok:true,settings,savedAt});
}
if(action==="calibration"){const b=req.method==="POST"?await body(req):{};const s=validSettings(b.settings||{}),doc=calibrationPdf(s);res.statusCode=200;res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition","inline; filename=piko-size-test.pdf");res.setHeader("Cache-Control","private, no-store");return res.end(doc)}
if(action==="labels"||action==="packing"){if(req.method!=="POST")return out(res,{error:"POST required"},405);const b=await body(req);if(!Array.isArray(b.orders)||!b.orders.length||b.orders.length>50)throw Error("Select between 1 and 50 orders.");const s=validSettings(b.settings||{}),doc=action==="labels"?labelsPdf(b.orders,s):packingPdf(b.orders,s);res.statusCode=200;res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition","inline; filename=piko-"+action+".pdf");res.setHeader("Cache-Control","private, no-store");return res.end(doc)}
if(action==="oauth-start"){if(!configured(c))throw Error("Set all eBay keys in Vercel first.");const state=crypto.randomBytes(20).toString("hex");setCookie(req,res,"piko_oauth",encrypted({state,exp:Date.now()+600000},c.secret),600);let url=new URL("https://auth"+(c.sandbox?".sandbox":"")+".ebay.com/oauth2/authorize");url.searchParams.set("client_id",c.id);url.searchParams.set("redirect_uri",c.ru);url.searchParams.set("response_type","code");url.searchParams.set("scope",scope);url.searchParams.set("state",state);res.statusCode=302;res.setHeader("Location",url.href);return res.end()}
if(action==="oauth-callback"){const saved=decrypted(cookie(req).piko_oauth,c.secret);if(u.searchParams.get("error"))throw Error(u.searchParams.get("error_description")||"eBay authorization denied");if(!saved||saved.exp<Date.now()||!equal(saved.state,u.searchParams.get("state")||""))throw Error("OAuth state verification failed");const t=await token(c,{grant_type:"authorization_code",code:u.searchParams.get("code")||"",redirect_uri:c.ru});if(!t.refresh_token)throw Error("eBay did not return a refresh token");setCookie(req,res,"piko_ebay",encrypted({refresh_token:t.refresh_token},c.secret),180*86400);setCookie(req,res,"piko_oauth","",0);res.statusCode=302;res.setHeader("Location","/");return res.end()}
return out(res,{error:"Unknown route"},404)
}catch(e){return out(res,{error:e.message||"Unexpected error"},400)}}
