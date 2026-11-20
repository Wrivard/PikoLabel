// Piko Books uses a separate private Supabase project and the existing Piko login.
// No browser-accessible database credentials.
import crypto from "node:crypto";
const endpoint=()=>String(process.env.PIKO_BOOKS_SUPABASE_URL||"").replace(/\/$/,"");
const secret=()=>String(process.env.PIKO_BOOKS_SUPABASE_SECRET_KEY||"");
const configured=()=>!!(endpoint()&&secret());
const json=(res,status,data)=>{res.statusCode=status;res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","private, no-store");res.end(JSON.stringify(data));};
async function sup(path,method="GET",body,headers={}){
 if(!configured())throw Error("Connect a dedicated Piko Books database first.");
 const response=await fetch(endpoint()+path,{method,headers:{apikey:secret(),Authorization:"Bearer "+secret(),...headers},body});
 if(!response.ok)throw Error("Storage request failed ("+response.status+"): "+(await response.text()).slice(0,200));
 return response;
}
async function read(req,max=2900000){
 let raw="";for await(const chunk of req){raw+=chunk.toString();if(raw.length>max)throw Error("Request too large (2 MB file limit).");}
 try{return JSON.parse(raw||"{}")}catch{throw Error("Invalid JSON")}
}
const categories=new Set(["inventory","shipping","packaging","platform_fees","software","equipment","office","other"]);
export function validateExpense(input){
 if(!input||typeof input!=="object")throw Error("Missing expense");
 const description=String(input.description||"").trim().slice(0,450);
 const seller=String(input.seller||"").trim().slice(0,150);
 const date=String(input.date||"");
 const amount=Math.round(Number(input.amount)*100);
 const gst=Math.round(Number(input.gst||0)*100),qst=Math.round(Number(input.qst||0)*100);
 if(!description)throw Error("Describe what was purchased");
 if(!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isFinite(Date.parse(date+"T00:00:00Z")))throw Error("Invalid purchase date");
 if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000)throw Error("Invalid purchase price");
 if(!Number.isSafeInteger(gst)||!Number.isSafeInteger(qst)||gst<0||qst<0||gst+qst>amount)throw Error("Invalid entered taxes");
 const category=categories.has(input.category)?input.category:"other";
 const quantity=input.quantity==null||input.quantity===""?null:Math.floor(Number(input.quantity));
 if(quantity!==null&&(!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000))throw Error("Invalid quantity");
 const proof=String(input.proof_path||"");
 if(proof&&!/^piko\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|png|jpg|webp)$/.test(proof))throw Error("Invalid document reference");
 return {expense_date:date,description,seller,category,amount_cents:amount,gst_cents:gst,qst_cents:qst,
 quantity,proof_path:proof||null,payment_source:input.payment_source==="business"?"business":"personal",
 seller_receipt:input.seller_receipt===true,source:"manual"};
}
export function summarize(entries){
 return entries.reduce((s,x)=>{s.count++;s.total+=x.amount_cents;if(x.category==="inventory")s.inventory+=x.amount_cents;else s.operating+=x.amount_cents;if(!x.proof_path)s.missing++;return s;},
 {count:0,total:0,inventory:0,operating:0,missing:0});
}
function money(c){return (Number(c||0)/100).toFixed(2)}
function escapeCsv(v){const s=String(v??"");return /^[=+\-@]/.test(s)||/[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function csv(rows){return "\ufeff"+rows.map(row=>row.map(escapeCsv).join(",")).join("\r\n")+"\r\n"}
async function entries(year){
 const query=new URLSearchParams({select:"*",and:"(expense_date.gte."+year+"-01-01,expense_date.lt."+(year+1)+"-01-01)",order:"expense_date.desc",limit:"5000"});
 return await (await sup("/rest/v1/piko_books_expenses?"+query.toString())).json();
}
export async function handleBooks(req,res,action){
 try{
  if(!configured())return json(res,503,{configured:false,error:"Piko Books requires its own Supabase project. Nothing is saved until connected."});
  const u=new URL(req.url,"https://piko.local");
  const year=Number(u.searchParams.get("year")||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2020||year>2100)throw Error("Invalid year");
  if(action==="list"&&req.method==="GET"){
   const list=await entries(year);return json(res,200,{configured:true,entries:list,summary:summarize(list),year});
  }
  if(action==="add"&&req.method==="POST"){
   const entry=validateExpense(await read(req,40000));
   const result=await (await sup("/rest/v1/piko_books_expenses","POST",JSON.stringify(entry),{"Content-Type":"application/json",Prefer:"return=representation"})).json();
   return json(res,201,{entry:result[0]});
  }
  if(action==="upload"&&req.method==="POST"){
   const b=await read(req);
   const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}[b.mime];
   if(!ext)throw Error("Use JPG, PNG, WebP or PDF");
   const raw=Buffer.from(String(b.base64||""),"base64");
   if(!raw.length||raw.length>2000000)throw Error("Receipts must be smaller than 2 MB.");
   if(ext==="pdf"&&raw.subarray(0,5).toString()!=="%PDF-")throw Error("Invalid PDF");
   if(ext==="jpg"&&(raw[0]!==255||raw[1]!==216))throw Error("Invalid JPG");
   if(ext==="png"&&!raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error("Invalid PNG");
   if(ext==="webp"&&raw.subarray(0,4).toString()!=="RIFF")throw Error("Invalid WebP");
   const id="piko/"+crypto.randomUUID()+"/"+crypto.randomUUID()+"."+ext;
   await sup("/storage/v1/object/piko-books-evidence/"+id,"POST",raw,{"Content-Type":b.mime,"x-upsert":"false"});
   return json(res,201,{path:id});
  }
  if(action==="export"&&req.method==="GET"){
   const list=await entries(year),totals=summarize(list);
   const rows=[["PIKO BOOKS — PERSONAL SOLE PROPRIETORSHIP",year],["PURCHASE RECORDS ONLY — not a tax return or net profit statement"],[],
     ["TOTAL PURCHASES",money(totals.total)],["INVENTORY ACQUIRED (NOT DEDUCTIBLE COGS)",money(totals.inventory)],["OTHER PURCHASES",money(totals.operating)],["MISSING ATTACHMENTS",totals.missing],[],
     ["Date","Category","Description","Seller","Amount CAD","GST entered","QST entered","Quantity","Paid with","Seller receipt","Evidence path"]];
   for(const v of list)rows.push([v.expense_date,v.category,v.description,v.seller,money(v.amount_cents),money(v.gst_cents),money(v.qst_cents),v.quantity??"",v.payment_source,v.seller_receipt?"Yes":"No",v.proof_path||""]);
   rows.push([],["IMPORTANT","Review entries with your accountant. Do not claim ITCs/ITRs without evidence. Import eBay sales and fees separately."]);
   res.statusCode=200;res.setHeader("Cache-Control","private, no-store");res.setHeader("Content-Type","text/csv; charset=utf-8");
   res.setHeader("Content-Disposition",'attachment; filename="PikoBooks_'+year+'_Purchases.csv"');
   return res.end(csv(rows));
  }
  if(action==="document"&&req.method==="GET"){
   const path=u.searchParams.get("path")||"";
   if(!/^piko\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(pdf|png|jpg|webp)$/.test(path))throw Error("Invalid document path");
   const found=await (await sup("/rest/v1/piko_books_expenses?"+new URLSearchParams({select:"id",proof_path:"eq."+path,limit:"1"}))).json();
   if(!found.length)throw Error("Document has not been attached to a purchase");
   const signed=await (await sup("/storage/v1/object/sign/piko-books-evidence/"+path,"POST",JSON.stringify({expiresIn:60}),{"Content-Type":"application/json"})).json();
   return json(res,200,{url:endpoint()+"/storage/v1"+signed.signedURL});
  }
  return json(res,405,{error:"Unsupported Books action"});
 }catch(err){return json(res,400,{error:err.message||"Books request failed"})}
}
