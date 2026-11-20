import {connectPrinter,reconnectRememberedPrinter,disconnectPrinter,isPrinterConnected,webBluetoothSupported,setPrinterStatusListener,testPage,printPages,printOrders} from "./munbyn-direct.js";
const $=id=>document.getElementById(id),state={orders:[],selected:new Set(),settings:{},auth:{},demo:true,view:"label",urls:[],docs:{packing:true,labels:true},previewUrl:null,previewSeq:0,previewTimer:null,screen:"orders"};const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));const money=v=>v?.value!=null?Number(v.value).toFixed(2)+" "+(v.currency||"CAD"):"";const qty=o=>(o.items||[]).reduce((n,i)=>n+Number(i.quantity||0),0);const toast=message=>{$("toast").textContent=message;setTimeout(()=>$("toast").textContent="",4000)};
async function call(path,options={}){const r=await fetch("/api/"+path,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...options}),t=r.headers.get("content-type")||"",v=t.includes("json")?await r.json():await r.text();if(!r.ok)throw Error(v.error||"Request failed");return v}
const addr=(name,a)=>[name,a?.line1,a?.line2,a?.cityStatePostal,a?.country].filter(Boolean).map(esc).join("<br>");
async function initialize(){try{state.auth=await call("bootstrap");$("login").classList.toggle("hidden",state.auth.authenticated);$("app").classList.toggle("hidden",!state.auth.authenticated);if(!state.auth.authenticated)return;$("login-device-status").textContent=state.auth.rememberedBrowser?"This browser is remembered. Your login renews automatically when you visit. Use Sign out to remove access.":"This is a temporary login. Sign out when finished.";let stored={};try{stored=JSON.parse(localStorage.getItem("piko-settings")||"{}")||{}}catch{}
  const serverSavedAt=Number(state.auth.settingsSavedAt||0),localSavedAt=Number(stored.settingsSavedAt||0);
  state.settings={...state.auth.settings,...(localSavedAt>=serverSavedAt?stored:state.auth.settings)};
  delete state.settings.settingsSavedAt;
  // Upgrade the old default 4 x 2 layout; preserve other previously customized sizes.
  if(!stored.labelProfile && Number(state.settings.labelWidth)===4 && Number(state.settings.labelHeight)===2){
    Object.assign(state.settings,{labelWidth:2.25,labelHeight:1.25,labelGap:0,labelMargin:.14,labelFont:10,labelBorder:false,labelProfile:"word"});
  } else if(stored.labelProfile==="word" && Number(stored.labelWidth)===4){
    Object.assign(state.settings,{labelWidth:2.25,labelHeight:1.25,labelGap:0,labelMargin:.14,labelFont:10,labelBorder:false,labelProfile:"word"});
  }try{state.docs={packing:true,labels:true,...JSON.parse(localStorage.getItem("piko-doc-choices")||"{}")}}catch{};$("include-packing").checked=state.docs.packing;$("include-labels").checked=state.docs.labels;populate();$("business-saved").textContent="Changes save automatically on this browser (not across devices).";void reconnectRememberedPrinter();await reload()}catch(e){toast(e.message)}}
function populate(){const s=state.settings,a=s.returnAddress||{};for(const [id,v] of Object.entries({storeName:s.storeName,returnName:s.returnName,line1:a.line1,line2:a.line2,cityStatePostal:a.cityStatePostal,country:a.country,thanks:s.thankYouMessage,width:s.labelWidth,height:s.labelHeight,font:s.labelFont,gap:s.labelGap}))$(id).value=v??"";$("border").checked=s.labelBorder!==false;$("labelPreset").value=s.labelProfile||((Number(s.labelWidth)===2.25&&Number(s.labelHeight)===1.25)?"word":"custom");$("connect").innerHTML=state.auth.connected?'<button id="disconnect" class="ghost">Disconnect eBay</button>':state.auth.ebayConfigured?'<a href="/api/oauth/start">Connect eBay →</a>':'<p>To connect real orders, add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME, APP_PASSWORD and APP_SECRET in Vercel settings.</p>';if($("disconnect"))$("disconnect").onclick=async()=>{await call("disconnect",{method:"POST"});location.reload()}}
async function reload(){try{let result=await call("orders");state.orders=result.orders;state.demo=result.demo;$("status").textContent=result.demo?"Demo mode":"eBay connected";$("status").className="pill "+(result.demo?"":"live");state.selected=new Set([...state.selected].filter(id=>state.orders.some(o=>o.id===id)));render()}catch(e){toast(e.message)}}
const filtered=()=>state.orders.filter(o=>JSON.stringify(o).toLowerCase().includes($("search").value.toLowerCase()));
function render(){const list=filtered();$("count").textContent=state.orders.length;$("selected-count").textContent=state.selected.size+" selected";$("all").checked=!!list.length&&list.every(o=>state.selected.has(o.id));$("orders-list").innerHTML=list.length?list.map(o=>'<div class="order '+(state.selected.has(o.id)?"selected":"")+'" data-id="'+esc(o.id)+'"><input type="checkbox" '+(state.selected.has(o.id)?"checked":"")+'><div class="order-data"><div class="order-top"><b>'+esc(o.shipTo?.name||o.buyer)+'</b><span>'+esc((o.createdAt||"").slice(0,10))+'</span></div><div class="meta">#'+esc(o.displayId||o.id)+' · '+qty(o)+' cards · '+money(o.total)+'</div><div class="desc">'+esc((o.items||[]).map(i=>i.title).join(" · "))+'</div></div></div>').join(""):'<div class="foot">No orders to display.</div>';for(const el of document.querySelectorAll(".order"))el.onclick=()=>{const id=el.dataset.id;state.selected.has(id)?state.selected.delete(id):state.selected.add(id);render()};updatePrintControls();queuePreview()}
// Preview the actual PDF returned by our server, using the currently selected eBay order.
const docName=()=>state.docs.packing&&state.docs.labels?"both":state.docs.packing?"packing slip":state.docs.labels?"address label":"none";
function updatePrintControls(){
 const count=state.selected.size,active=!!(state.docs.packing||state.docs.labels),busy=state.working;
 const type=state.docs.packing&&state.docs.labels?"MUNBYN labels + Canon slips":state.docs.packing?"Canon packing slips":state.docs.labels?"MUNBYN Bluetooth labels":"documents";
 const label=(state.docs.labels?"Print ":"Prepare ")+type+" · "+count+" order"+(count===1?"":"s")+" →";
 $("print").textContent=busy?"Working…":label;$("print").disabled=!count||!active||busy||state.directBusy;
 $("tablet-print").textContent=busy?"Working…":(state.docs.labels?"Print →":"Prepare →");$("tablet-print").disabled=!count||!active||busy||state.directBusy;
 $("dock-orders").textContent=count+" order"+(count===1?"":"s")+" selected";$("dock-docs").textContent=active?type:"Select at least one document";
 $("include-packing").checked=state.docs.packing;$("include-labels").checked=state.docs.labels;
 $("direct-print").disabled=!count||busy||state.directBusy;
}
function queuePreview(){
 clearTimeout(state.previewTimer);
 const seq=++state.previewSeq;
 const order=state.orders.find(x=>state.selected.has(x.id))||state.orders[0];
 $("view-label").classList.toggle("on",state.view==="label");$("view-slip").classList.toggle("on",state.view==="slip");
 $("label-desc").textContent=state.settings.labelWidth+" × "+state.settings.labelHeight+" in · 2 labels/order · MUNBYN";
 if(!order){$("preview-doc").replaceChildren();$("preview-status").textContent="Select an order to see its exact printable PDF.";$("preview-note").textContent="";return}
 $("preview-status").textContent="Generating actual PDF preview…";
 $("preview-note").textContent="Order #"+(order.displayId||order.id)+" · "+(state.view==="label"?"Thermal label":"US Letter packing slip")+(state.selected.size>1?" · first selected order":"");
 state.previewTimer=setTimeout(()=>renderPdfPreview(order,seq),280);
}
async function renderPdfPreview(order,seq){
 try{
  const name=state.view==="label"?"labels":"packing";
  const r=await fetch("/api/documents/"+name,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({orders:[order],settings:state.settings})});
  if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error||"PDF preview unavailable")}
  if(seq!==state.previewSeq)return;
  const url=URL.createObjectURL(await r.blob());
  if(seq!==state.previewSeq){URL.revokeObjectURL(url);return}
  const old=state.previewUrl;state.previewUrl=url;
  const title=state.view==="label"?"Actual label PDF":"Actual packing slip PDF";
  const frame=document.createElement("iframe");frame.className="pdf-iframe";frame.title=title;frame.loading="eager";frame.src=url+"#toolbar=0&navpanes=0&view=Fit";
  const wrapper=document.createElement("div");wrapper.className="pdf-sheet "+(state.view==="label"?"pdf-thermal":"pdf-letter");if(state.view==="label")wrapper.style.aspectRatio=String(Number(state.settings.labelWidth)||2.25)+"/"+String(Number(state.settings.labelHeight)||1.25);wrapper.appendChild(frame);
  const open=document.createElement("a");open.className="preview-open";open.href=url;open.target="_blank";open.rel="noopener";open.textContent="Open full PDF preview ↗";
  $("preview-doc").replaceChildren(wrapper,open);
  $("preview-status").textContent=state.demo?"Exact PDF preview · Demo order":"Exact PDF preview · eBay order";
  if(old)setTimeout(()=>URL.revokeObjectURL(old),1000);
 }catch(e){if(seq!==state.previewSeq)return;$("preview-doc").replaceChildren();$("preview-status").textContent="Unable to preview PDF: "+e.message}
}
function screen(v){state.screen=v;$("tablet-dock").classList.toggle("hidden",v!=="orders");$("orders-screen").classList.toggle("hidden",v!=="orders");$("settings-screen").classList.toggle("hidden",v!=="settings");$("tab-orders").classList.toggle("on",v==="orders");$("tab-settings").classList.toggle("on",v==="settings");$("title").textContent=v==="orders"?"Shipping workspace":"Settings"}
$("login-form").onsubmit=async e=>{e.preventDefault();$("login-error").textContent="";try{await call("login",{method:"POST",body:JSON.stringify({password:$("password").value,remember:$("remember-browser").checked})});$("password").value="";await initialize()}catch(e){$("login-error").textContent=e.message}};
$("tab-orders").onclick=()=>screen("orders");$("tab-settings").onclick=()=>screen("settings");$("refresh").onclick=reload;$("reload").onclick=reload;$("search").oninput=render;$("all").onchange=e=>{for(const o of filtered())e.target.checked?state.selected.add(o.id):state.selected.delete(o.id);render()};$("view-label").onclick=()=>{state.view="label";queuePreview()};$("view-slip").onclick=()=>{state.view="slip";queuePreview()};
for(const [id,kind] of [["include-packing","packing"],["include-labels","labels"]])$(id).onchange=e=>{state.docs[kind]=e.target.checked;localStorage.setItem("piko-doc-choices",JSON.stringify(state.docs));updatePrintControls()};
$("tablet-print").onclick=()=>$("print").click();
let settingsVersion=0,savedVersion=0,saveTimer=null,saveRunning=false;
function collectSettings(){
 const s=state.settings;
 s.storeName=$("storeName").value;s.returnName=$("returnName").value;
 s.returnAddress={line1:$("line1").value,line2:$("line2").value,cityStatePostal:$("cityStatePostal").value,country:$("country").value};
 s.thankYouMessage=$("thanks").value;
 s.labelWidth=Number($("width").value)||s.labelWidth;
 s.labelHeight=Number($("height").value)||s.labelHeight;
 s.labelFont=Number($("font").value)||s.labelFont;
 s.labelGap=Number($("gap").value);
 s.labelBorder=$("border").checked;
 s.labelProfile=$("labelPreset").value;
 s.labelMargin=Number(s.labelMargin??.14);
 return {...s,returnAddress:{...s.returnAddress}};
}
function statusSave(message,failed=false){
 for(const id of ["business-saved","saved"]){$(id).textContent=message;$(id).classList.toggle("save-error",failed)}
}
function scheduleSettingsSave(immediate=false){
 collectSettings();settingsVersion++;
 try{localStorage.setItem("piko-settings",JSON.stringify({...state.settings,settingsSavedAt:Date.now()}))}catch{}
 statusSave("Saving changes…");
 clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistSettings(),immediate?0:700);
}
async function persistSettings(){
 clearTimeout(saveTimer);if(saveRunning)return;saveRunning=true;
 try{
  while(savedVersion<settingsVersion){
   const snapshot={...state.settings,returnAddress:{...state.settings.returnAddress}},version=settingsVersion;
   await call("settings",{method:"POST",body:JSON.stringify({settings:snapshot})});
   savedVersion=version;
   if(savedVersion===settingsVersion)statusSave("Saved ✓ Your details will load next time you open this browser.");
  }
 }catch(e){statusSave("Browser backup failed: "+e.message+". Tap Save to retry.",true)}
 finally{saveRunning=false}
}
for(const id of ["storeName","returnName","line1","line2","cityStatePostal","country","thanks"])$(id).addEventListener("input",()=>scheduleSettingsSave());
$("business-save").onclick=()=>scheduleSettingsSave(true);
$("save").onclick=()=>scheduleSettingsSave(true);

$("logout").onclick=async()=>{await call("logout",{method:"POST"});location.reload()};$("close").onclick=()=>{$("modal").classList.add("hidden")};
// The main action prints MUNBYN labels over BLE and prepares only Canon PDFs.
$("print").onclick=async()=>{
 const orders=state.orders.filter(o=>state.selected.has(o.id));
 const needLabels=state.docs.labels,needPacking=state.docs.packing;
 if(!orders.length||(!needLabels&&!needPacking)||state.working||state.directBusy)return;
 if(needLabels&&orders.length>25){toast("Direct MUNBYN printing supports up to 25 orders per batch.");return}
 // The Web Bluetooth permission chooser MUST begin synchronously in this click event.
 const connection=needLabels?(isPrinterConnected()?Promise.resolve():connectPrinter()):Promise.resolve();
 state.working=true;updatePrintControls();
 try{
  if(needLabels){
   await connection;
   bluetoothStatus("Sending "+(orders.length*2)+" address labels directly to MUNBYN…");
   await printOrders(orders,state.settings);
  }
  if(needPacking){
   const r=await fetch("/api/documents/packing",{
    method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({orders,settings:state.settings})
   });
   if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error||"Unable to prepare Canon packing slips")}
   const url=URL.createObjectURL(await r.blob());
   state.urls.forEach(URL.revokeObjectURL);state.urls=[url];
   $("packing-link").classList.remove("hidden");$("packing-link").href=url;
   $("labels-link").classList.add("hidden");$("labels-link").removeAttribute("href");
   $("ready").textContent=(needLabels?orders.length*2+" MUNBYN labels sent via Bluetooth. ":"")+
     orders.length+" packing slip"+(orders.length===1?"":"s")+" ready to print on Canon.";
   $("modal").classList.remove("hidden");
  }else{
   toast(orders.length*2+" labels sent to MUNBYN. Check the printed paper.");
  }
 }catch(e){
  const msg=e?.message||"Printing failed";
  bluetoothStatus(msg,"error");
  toast(msg);
 }finally{state.working=false;updatePrintControls()}
};
function testPrinter(type){
  const isLabel=type==="label";
  const w=Math.min(4.3,Math.max(2.2,Number(state.settings.labelWidth)||2.25));
  const h=Math.min(6.2,Math.max(1.25,Number(state.settings.labelHeight)||1.25));
  const format=isLabel?`${w}in ${h}in`:"letter";
  const title=isLabel?"THERMAL ADDRESS LABEL TEST":"PACKING SLIP PRINTER TEST";
  const sample=isLabel?"<div class=\"sheet-label\"><b>Ship from</b><p>Piko Cards<br>Sample return address<br>Canada</p></div><div class=\"sheet-label\"><b>Ship to</b><p>Example customer<br>123 Sample Street<br>Canada</p></div>":"<h1>PIKO CARDS</h1><p>Printer test · US Letter · 8.5 × 11 in</p><hr><p>This is a sample packing slip, not an actual order.</p>";
  const pop=window.open("","_blank");
  if(!pop){toast("Allow pop-ups to open your print preview.");return}
  const page=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>@page{size:${format};margin:${isLabel?".06in":".3in"}}body{font-family:Arial,sans-serif;color:#111;background:white;margin:0;padding:0}.sheet{box-sizing:border-box;width:100%;padding:${isLabel?".07in":".15in"}}h1{font-size:20pt}.sheet p{font-size:${isLabel?"8pt":"12pt"};line-height:1.4}.cells{display:grid;grid-template-columns:1fr 1fr;gap:.13in}.cells section+section{border-left:1px dashed #777;padding-left:.13in}.cells b{font-size:8pt}.sheet-label{break-after:page;page-break-after:always}.sheet-label b{font-size:10pt}.sheet-label p{font-size:10pt}.tools{font:14px system-ui;background:#f4f4f4;padding:15px;margin:12px 0}.tools button{font:inherit;padding:9px 15px;cursor:pointer}@media print{.tools{display:none}}</style></head><body><div class="tools">This print preview lets Android show its installed printers. Printing only happens if you confirm. <button onclick="window.print()">Choose printer / Print</button></div><div class="sheet">${sample}</div></body></html>`;
  pop.document.open();pop.document.write(page);pop.document.close();pop.focus();
  // Some Android browsers block automatic print dialogs; the visible button is a fallback.
  try{pop.print()}catch{}
}
$("labelPreset").onchange=()=>{
 const preset=$("labelPreset").value;
 if(preset==="word"){
  for(const [id,v] of Object.entries({width:2.25,height:1.25,font:10,gap:0}))$(id).value=v;
  Object.assign(state.settings,{labelWidth:2.25,labelHeight:1.25,labelFont:10,labelGap:0,labelMargin:.14,labelBorder:false,labelProfile:"word"});
 }else if(preset==="standard"){
  for(const [id,v] of Object.entries({width:4,height:2,font:8.5,gap:.13}))$(id).value=v;
  Object.assign(state.settings,{labelWidth:4,labelHeight:2,labelFont:8.5,labelGap:.13,labelMargin:.12,labelProfile:"standard"});
 }else state.settings.labelProfile="custom";
 scheduleSettingsSave();queuePreview();
};
for(const [id,key] of [["width","labelWidth"],["height","labelHeight"],["font","labelFont"],["gap","labelGap"]]){
 $(id).addEventListener("change",()=>{
  state.settings[key]=Number($(id).value)||state.settings[key];
  state.settings.labelProfile="custom";$("labelPreset").value="custom";
  scheduleSettingsSave();queuePreview();
 });
}
$("border").addEventListener("change",()=>{scheduleSettingsSave();queuePreview()});
$("calibration").onclick=async()=>{
 // Open a tab during the user gesture before asynchronously requesting PDF.
 const pop=window.open("","_blank");
 if(!pop){toast("Allow pop-ups for the size test PDF.");return}
 pop.document.write("<p style='font:16px sans-serif;padding:30px'>Preparing exact-size test PDF…</p>");
 try{
   const r=await fetch("/api/documents/calibration",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({settings:state.settings})});
   if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||"Calibration PDF failed");
   const url=URL.createObjectURL(await r.blob());pop.location.href=url;
 }catch(e){pop.close();toast(e.message)}
};
$("test-canon").onclick=()=>testPrinter("letter");
$("test-munbyn").onclick=()=>testPrinter("label");
// BLE only: Android's system print destination list cannot connect to this proprietary printer.
function bluetoothStatus(message,type="info"){
 for(const id of ["bluetooth-status","direct-print-status"]){$(id).textContent=message;$(id).dataset.status=type;}
 $("direct-test").disabled=!isPrinterConnected()||state.directBusy;
 $("direct-disconnect").disabled=!isPrinterConnected()||state.directBusy;
 $("direct-connect").textContent=isPrinterConnected()?"MUNBYN connected ✓":"Connect MUNBYN Bluetooth";
 $("direct-print").disabled=!state.selected.size||state.directBusy||state.working;
}
setPrinterStatusListener(bluetoothStatus);
async function directConnect(){
 try{await connectPrinter();bluetoothStatus("MUNBYN connected. Print one test label first.","success");}
 catch(e){bluetoothStatus(e.message,"error");}
}
$("direct-connect").onclick=directConnect;
$("direct-disconnect").onclick=()=>{try{disconnectPrinter()}catch(e){bluetoothStatus(e.message,"error")}};
$("direct-test").onclick=async()=>{
 state.directBusy=true;updatePrintControls();bluetoothStatus("Preparing one calibration label…");
 try{await printPages([testPage(state.settings)],state.settings)}
 catch(e){bluetoothStatus(e.message,"error")}
 finally{state.directBusy=false;updatePrintControls()}
};
$("direct-print").onclick=async()=>{
 const orders=state.orders.filter(o=>state.selected.has(o.id));
 if(!orders.length)return;
 // Call the BLE device chooser from the user gesture if the printer was not connected.
 const connection=isPrinterConnected()?Promise.resolve():connectPrinter();
 state.directBusy=true;updatePrintControls();
 try{await connection;await printOrders(orders,state.settings);}
 catch(e){bluetoothStatus(e.message,"error");}
 finally{state.directBusy=false;updatePrintControls();}
};
if(!webBluetoothSupported())bluetoothStatus("Direct Bluetooth requires Chrome on Android, and may not work on every printer firmware.","warning");
$("tablet-dock").classList.remove("hidden");
initialize();