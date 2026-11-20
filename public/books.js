// Minimal personal-business purchase ledger. The app never claims to file taxes.
const el=id=>document.getElementById(id);
const txt=v=>String(v??"");
const h=v=>txt(v).replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const cad=c=>new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(Number(c||0)/100);
let pendingFile=null,enabled=false,busy=false;
async function api(name,opts={}){
 const r=await fetch("/api/books/"+name,{credentials:"same-origin",...opts});
 const json=await r.json();
 if(!r.ok)throw Error(json.error||"Request failed");
 return json;
}
function status(message,error=false){el("books-status").textContent=message;el("books-status").dataset.status=error?"error":"info";}
function smartCategory(text){
 const s=txt(text).toLowerCase();
 if(/canada post|ups|fedex|postage|shipping label|postes canada/.test(s))return "shipping";
 if(/envelope|sleeve|team bag|tape|cardboard|packaging|bubble mailer/.test(s))return "packaging";
 if(/carduploader|software|subscription/.test(s))return "software";
 if(/ebay fee|promoted listing/.test(s))return "platform_fees";
 return "inventory";
}
function showFile(file){
 if(!file)return;
 pendingFile=file;
 el("books-file-name").textContent=file.name+" ("+(file.size/1024).toFixed(0)+" KB)";
 if(!el("books-description").value)el("books-description").value=file.name.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ");
 el("books-category").value=smartCategory((file.name||"")+" "+el("books-seller").value);
 if(file.size>2000000)status("File is larger than 2 MB. Compress it before saving.",true);
}
export function initializeBooks(){
 const now=new Date();
 el("books-date").value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
 el("books-year").value=String(now.getFullYear());
 const input=el("books-file"),drop=el("books-drop");
 drop.onclick=()=>input.click();
 drop.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();input.click()}};
 input.onchange=()=>showFile(input.files[0]);
 drop.ondragover=e=>{e.preventDefault();drop.classList.add("active")};
 drop.ondragleave=()=>drop.classList.remove("active");
 drop.ondrop=e=>{e.preventDefault();drop.classList.remove("active");showFile(e.dataTransfer.files[0])};
 el("books-year").onchange=refreshBooks;
 el("books-export").onclick=async()=>{
  if(!enabled)return status("Connect the dedicated Books database before exporting.",true);
  const year=Number(el("books-year").value);
  // The existing Piko session cookie authorizes the download.
  const response=await fetch("/api/books/export?year="+year,{credentials:"same-origin"});
  if(!response.ok){const j=await response.json();return status(j.error||"Export failed",true)}
  const u=URL.createObjectURL(await response.blob());
  const a=document.createElement("a");a.href=u;a.download="PikoBooks_"+year+"_Purchases.csv";a.click();
  setTimeout(()=>URL.revokeObjectURL(u),2000);
 };
 el("books-form").onsubmit=save;
}
export async function refreshBooks(){
 if(!el("books-screen")||el("books-screen").classList.contains("hidden"))return;
 const year=Number(el("books-year").value);
 try{
  const data=await api("list?year="+year);enabled=true;
  status("Private database connected · purchases saved securely.");
  const sum=data.summary||{};
  el("books-summary").innerHTML='<div><small>Operating purchases</small><strong>'+cad(sum.operating)+'</strong></div>'+
   '<div><small>Inventory acquired</small><strong>'+cad(sum.inventory)+'</strong></div>'+
   '<div><small>Missing proof</small><strong>'+Number(sum.missing||0)+'</strong></div>';
  el("books-list").innerHTML=data.entries.length?data.entries.map(x=>'<article class="books-entry"><div><b>'+h(x.description)+'</b><small>'+h(x.expense_date)+' · '+h(x.seller||x.category)+' · '+h(x.payment_source)+'</small></div><strong>'+cad(x.amount_cents)+'</strong></article>').join(""):'<p>No purchases recorded yet.</p>';
 }catch(error){
  enabled=false;
  el("books-summary").innerHTML="";
  el("books-list").innerHTML='<p>Books is not connected yet. Existing Label Printer features continue working normally.</p>';
  status(error.message,true);
 }
}
async function fileAsBase64(file){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(Error("Unable to read receipt"));
  reader.onload=()=>resolve(String(reader.result).split(",")[1]);
  reader.readAsDataURL(file);
 });
}
async function save(e){
 e.preventDefault();
 if(busy)return;
 if(!enabled)return status("Connect the dedicated Books database first; no purchase has been saved.",true);
 const btn=el("books-save");
 busy=true;btn.disabled=true;btn.textContent="Saving…";
 try{
  let path="";
  if(pendingFile){
   if(pendingFile.size>2000000)throw Error("Receipt exceeds the 2 MB upload limit.");
   const upload=await api("upload",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mime:pendingFile.type,name:pendingFile.name,base64:await fileAsBase64(pendingFile)})});
   path=upload.path;
  }
  const entry={
   date:el("books-date").value,
   amount:el("books-amount").value,
   seller:el("books-seller").value,
   description:el("books-description").value,
   category:el("books-category").value,
   payment_source:el("books-paid").value,
   quantity:el("books-quantity").value,
   gst:el("books-gst").value,
   qst:el("books-qst").value,
   seller_receipt:el("books-receipt").checked,
   proof_path:path
  };
  await api("add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(entry)});
  el("books-form").reset();pendingFile=null;el("books-file-name").textContent="";
  status("Purchase saved with its evidence. No GST/QST credit is assumed.");
  await refreshBooks();
 }catch(error){status(error.message,true)}
 finally{busy=false;btn.disabled=false;btn.textContent="Save purchase"}
}
