"use client";
import {salesPriceDefault} from "@/lib/product-price-defaults";
import {readStockSacks} from "@/lib/stock-sacks";

import Link from "next/link";
import {DraftBill} from "@/components/draft-bill";
import {useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowRight,Check,CloudOff,Layers3,Minus,Plus,Search,ShoppingCart,Trash2,UserPlus,X} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {OfflinePosStatus} from "@/components/offline-pos-status";
import {clearPosDraft,deletePosTask,enqueuePosTask,loadCachedStock,loadPosDraft,listPosDrafts,listPosTasks,saveCachedStock,savePosDraft,syncPosTasks,type OfflinePosTask,type StoredPosDraft} from "@/lib/offline-pos";
import {Bank,Center,Customer,Line,Payment,Price,Product,Stock,cents,methods,money} from "./types";
import "./sales-pos.css";
import {DetailedSalesEntry} from "./detailed-sales-entry";

type LaborSession={id:string;center_id:string;title:string;operation:string;session_date:string};
type SaleDraft={centerId:string;lines:Line[];payments:Payment[];customerId:string;notes:string;checkout:boolean;laborSessionId?:string;laborLoadCount?:string;entryMode?:"pos"|"detailed";requestId?:string|null};
type Props={organizationId?:string;centers:Center[];customers:Customer[];products:Product[];prices:Price[];banks:Bank[];laborSessions:LaborSession[];organizationName?:string;userName?:string;scopeId:string};
const newPayment=(amount:number,key="initial"):Payment=>({key,method:"cash",amount:amount.toFixed(2),bank_account_id:"",reference:"",cheque_number:"",cheque_date:""});
const qty=(n:number)=>n.toLocaleString("en-LK",{maximumFractionDigits:3});
const roundedQty=(n:number)=>Math.round(n*1000)/1000;

export function SalesPOS({organizationId,centers,customers:initialCustomers,products,prices,banks,laborSessions,organizationName="CenterPro",userName,scopeId}:Props){
 const [centerId,setCenterId]=useState(centers[0]?.id??"");
 const [stock,setStock]=useState<Stock[]>([]),[stockReady,setStockReady]=useState(false),[stockError,setStockError]=useState(""),[refresh,setRefresh]=useState(0);
 const [lines,setLines]=useState<Line[]>([]),[search,setSearch]=useState(""),[category,setCategory]=useState("all"),[checkout,setCheckout]=useState(false);
 const [entryMode,setEntryMode]=useState<"pos"|"detailed">("pos");
 const [payments,setPayments]=useState<Payment[]>([]),[customerId,setCustomerId]=useState(""),[customers,setCustomers]=useState(initialCustomers),[notes,setNotes]=useState("");
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[customerBusy,setCustomerBusy]=useState(false),[customerError,setCustomerError]=useState(""),[customerOpen,setCustomerOpen]=useState(false);
 const [laborSessionId,setLaborSessionId]=useState(""),[laborLoadCount,setLaborLoadCount]=useState("0");
 const [draftReady,setDraftReady]=useState(false),[offlineQueued,setOfflineQueued]=useState(false),[pendingTotal,setPendingTotal]=useState(0),[offlineQueueError,setOfflineQueueError]=useState(""),[offlineNeedsCorrection,setOfflineNeedsCorrection]=useState(false),[isOnline,setIsOnline]=useState(true);
 const requestId=useRef<string|null>(null),submitLock=useRef(false),customerLock=useRef(false);
 const syncLock=useRef(false),baseDraftKey=`sale:${scopeId}`;
 const [draftKey,setDraftKey]=useState(baseDraftKey),[draftBooted,setDraftBooted]=useState(false);
 const [storedDrafts,setStoredDrafts]=useState<StoredPosDraft<SaleDraft>[]>([]);
 const [switchingDraft,setSwitchingDraft]=useState(false),[showDraftMenu,setShowDraftMenu]=useState(false);
 const draftReference=draftKey===baseDraftKey?"D-0001":`D-${draftKey.slice(baseDraftKey.length+1).replaceAll("-", "").slice(0,6).toUpperCase()}`;
 const heldDrafts=storedDrafts.filter(row=>row.key!==draftKey);
 useEffect(()=>{
  const params=new URL(window.location.href).searchParams;
  const id=params.get("draft");
  setDraftKey(id&&/^[a-f0-9-]{36}$/i.test(id)?`${baseDraftKey}:${id}`:baseDraftKey);
  setDraftBooted(true);
 },[baseDraftKey]);
 useEffect(()=>{
  try{setEntryMode(localStorage.getItem("centerpro-sales-view")==="detailed"?"detailed":"pos");}catch{setEntryMode("pos");}
 },[]);
 useEffect(()=>{if(!showDraftMenu)return;const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setShowDraftMenu(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[showDraftMenu]);
 function changeEntryMode(mode:"pos"|"detailed"){
  setEntryMode(mode);
  try{localStorage.setItem("centerpro-sales-view",mode);}catch{/* View still works in private browsing. */}
 }
 function draftSnapshot():SaleDraft{return {centerId,lines,payments,customerId,notes,checkout,laborSessionId,laborLoadCount,entryMode,requestId:requestId.current};}
 async function switchSalesDraft(targetKey?:string){
  if(busy||switchingDraft||!draftReady)return;
  setSwitchingDraft(true);setShowDraftMenu(false);
  try{
   const snapshot=draftSnapshot();
   if(snapshot.lines.length||snapshot.notes||snapshot.customerId||snapshot.laborSessionId){await savePosDraft(draftKey,snapshot);}
   else{await clearPosDraft(draftKey);}
   const target=targetKey??`${baseDraftKey}:${crypto.randomUUID()}`;
   if(target===draftKey){setSwitchingDraft(false);return;}
   const suffix=target===baseDraftKey?"":`?draft=${encodeURIComponent(target.slice(baseDraftKey.length+1))}`;
   window.location.assign(`/dashboard/sales/new${suffix}`);
  }catch(e){setError(e instanceof Error?e.message:"Could not hold this sale. Retry before starting another.");setSwitchingDraft(false);}
 }

 const searchRef=useRef<HTMLInputElement>(null),centerRef=useRef<HTMLSelectElement>(null),paymentForm=useRef<HTMLFormElement>(null),customerDialog=useRef<HTMLDialogElement>(null),customerNameRef=useRef<HTMLInputElement>(null);
 const center=centers.find(c=>c.id===centerId);
 const locations=(center?.locations??[]).filter(l=>l.is_active&&(center?.allow_multiple_locations||l.is_default));
 const categories=[...new Set(products.map(p=>p.category?.trim()||"Uncategorized"))].sort();

 const available=(qualityId:string,locationId:string)=>Number(stock.find(s=>s.quality_id===qualityId&&s.location_id===locationId)?.quantity??0);
 const used=(qualityId:string,locationId:string)=>lines.filter(l=>l.quality_id===qualityId&&l.location_id===locationId).reduce((n,l)=>n+Number(l.quantity),0);
 const totalCents=lines.reduce((n,l)=>n+cents(Number(l.quantity)*l.unit_price),0);
 const rows=payments.length?payments:[newPayment(totalCents/100)];
 const allocated=rows.reduce((n,p)=>n+cents(Number(p.amount)),0),credit=rows.filter(p=>p.method==="credit").reduce((n,p)=>n+cents(Number(p.amount)),0);
 const difference=totalCents-allocated;
 const invalidLine=(l:Line)=>(products.find(p=>p.id===l.product_id)?.tracks_sacks&&(!Number.isInteger(l.sack_count)||(l.sack_count??-1)<0||lines.filter(x=>x.quality_id===l.quality_id&&x.location_id===l.location_id).reduce((sum,x)=>sum+(x.sack_count??0),0)>(stock.find(s=>s.quality_id===l.quality_id&&s.location_id===l.location_id)?.sacks??0)))||!l.location_id||!Number.isFinite(Number(l.quantity))||Number(l.quantity)<=0||Math.abs(roundedQty(Number(l.quantity))-Number(l.quantity))>0.0000001||roundedQty(used(l.quality_id,l.location_id))>roundedQty(available(l.quality_id,l.location_id))||!Number.isFinite(l.unit_price)||l.unit_price<=0||l.unit_price>=1000000000000||Math.abs(l.unit_price*100-Math.round(l.unit_price*100))>0.00001||cents(Number(l.quantity)*l.unit_price)<=0;
 const cartInvalid=lines.some(invalidLine);
 const canCheckout=stockReady&&lines.length>0&&!cartInvalid&&Number.isFinite(totalCents)&&totalCents>0;
 const canConfirm=canCheckout&&difference===0&&rows.every(p=>Number.isFinite(Number(p.amount))&&Number(p.amount)>0)&&(!credit||!!customerId);
 const unitTotals=[...lines.reduce((totals,l)=>{const unit=products.find(p=>p.id===l.product_id)?.unit_of_measure??"";totals.set(unit,(totals.get(unit)??0)+Number(l.quantity));return totals;},new Map<string,number>())].map(([unit,n])=>qty(n)+" "+unit).join(" · ");
 const filtered=products.filter(p=>(category==="all"||(p.category?.trim()||"Uncategorized")===category)&&[p.name,p.code,...p.product_qualities.map(q=>q.name)].join(" ").toLowerCase().includes(search.trim().toLowerCase()));

 useEffect(()=>{
  if(!draftBooted)return;
  let live=true;
  void Promise.all([loadPosDraft<SaleDraft>(draftKey),listPosDrafts<SaleDraft>(baseDraftKey),listPosTasks(scopeId,"sale")]).then(([draft,drafts,tasks])=>{
   if(!live)return;
   setStoredDrafts(drafts.filter(row=>Boolean(row.value?.lines?.length||row.value?.customerId||row.value?.notes||row.value?.laborSessionId)));
   if(draft){
    setCenterId(draft.centerId);setLines(draft.lines);setPayments(draft.payments);
    setCustomerId(draft.customerId);setNotes(draft.notes);setCheckout(draft.checkout);
    setLaborSessionId(draft.laborSessionId??"");setLaborLoadCount(draft.laborLoadCount??"0");
    requestId.current=draft.requestId??null;
   }
   // Pending sales are separate from unfinished drafts. Never bind a queued sale
   // from another draft to the current order or block creation of a new sale.
   const activeTask=tasks.find(task=>task.requestId===requestId.current)||
     (draftKey===baseDraftKey&&!draft?.lines?.length?tasks[0]:undefined);
   if(activeTask){
    requestId.current=activeTask.requestId;setOfflineQueued(true);
    setPendingTotal(Number(activeTask.payload.totalCents??0)/100);
    setOfflineQueueError(activeTask.lastError??"");setOfflineNeedsCorrection(Boolean(activeTask.needsCorrection));
   }
  }).catch(()=>{}).finally(()=>{if(live)setDraftReady(true);});
  return()=>{live=false;};
 },[draftBooted,draftKey,baseDraftKey,scopeId]);
 useEffect(()=>{
  if(!draftReady||offlineQueued||switchingDraft)return;
  void savePosDraft(draftKey,draftSnapshot()).catch(()=>{});
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[draftReady,offlineQueued,switchingDraft,draftKey,centerId,lines,payments,customerId,notes,checkout,laborSessionId,laborLoadCount,entryMode]);
 useEffect(()=>{const update=()=>setIsOnline(navigator.onLine);update();window.addEventListener("online",update);window.addEventListener("offline",update);return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);};},[]);
 useEffect(()=>{
  let active=true;
  const syncPending=async()=>{
   if(!draftReady||!navigator.onLine||syncLock.current)return;syncLock.current=true;
   try{const completed=await syncPosTasks(createClient(),scopeId,"sale");if(!active)return;for(const {task,id} of completed){if(task.requestId===requestId.current){await clearPosDraft(draftKey).catch(()=>{});window.location.assign("/dashboard/sales/"+id);return;}}const tasks=await listPosTasks(scopeId,"sale");if(active){const failed=tasks.find(task=>task.lastError);setOfflineQueueError(failed?.lastError??"");setOfflineNeedsCorrection(Boolean(failed?.needsCorrection));}}
   finally{syncLock.current=false;}
  };
  window.addEventListener("online",syncPending);window.addEventListener("centerpro-pos-queue",syncPending);void syncPending();
  return()=>{active=false;window.removeEventListener("online",syncPending);window.removeEventListener("centerpro-pos-queue",syncPending);};
 },[scopeId,draftKey,offlineQueued,draftReady]);

 useEffect(()=>{
  let cancelled=false;if(!centerId)return;
  async function load(){const cacheKey=`${scopeId}:${centerId}`;const cached=await loadCachedStock<Stock[]>(cacheKey).catch(()=>null);if(cancelled)return;if(cached&&!navigator.onLine){setStock(cached);setStockReady(true);setStockError("");return;}try{const {data,error}=await createClient().rpc("sales_stock",{p_center:centerId});if(cancelled)return;if(error){if(cached){setStock(cached);setStockReady(true);setStockError("Showing saved stock. Final stock is checked when the sale syncs.");return;}setStockError(error.message);return;}const sackBalances=organizationId?await readStockSacks(createClient(),organizationId):new Map<string,number>();if(cancelled)return;const withSacks=(data??[]).map((row:Stock)=>({...row,sacks:sackBalances.get([centerId,row.location_id,row.product_id,row.quality_id].join(":"))}));setStock(withSacks);setStockReady(true);void saveCachedStock(cacheKey,withSacks).catch(()=>{});}catch{if(!cancelled){if(cached){setStock(cached);setStockReady(true);setStockError("Showing saved stock. Final stock is checked when the sale syncs.");}else setStockError("Stock is unavailable offline. Open this sales POS while connected once to save a stock snapshot.");}}}
  void load();return()=>{cancelled=true};
 },[centerId,refresh,scopeId,organizationId]);
 useEffect(()=>{
  function keydown(e:KeyboardEvent){
   if(busy||customerOpen||showDraftMenu||e.altKey||e.ctrlKey||e.metaKey)return;
   if(e.key==="F2"&&!checkout){e.preventDefault();searchRef.current?.focus();}
   if(e.key==="F4"&&!checkout){e.preventDefault();centerRef.current?.focus();}
   if(e.key==="F9"&&!checkout){e.preventDefault();if(canCheckout){setError("");setCheckout(true);}}
   if(e.key==="F10"&&checkout){e.preventDefault();if(canConfirm)paymentForm.current?.requestSubmit();}
   if(e.key==="Escape"&&checkout){e.preventDefault();setCheckout(false);}
  }
  window.addEventListener("keydown",keydown);return()=>window.removeEventListener("keydown",keydown);
 },[busy,customerOpen,showDraftMenu,checkout,canCheckout,canConfirm]);
 useEffect(()=>{if(customerOpen){customerDialog.current?.showModal();customerNameRef.current?.focus();}else customerDialog.current?.close();},[customerOpen]);

 function changeCenter(id:string){
  if(id===centerId)return;
  if(lines.length&&!window.confirm("Change center and clear this sale?"))return;
  setCenterId(id);setStock([]);setStockReady(false);setStockError("");setLines([]);setPayments([]);setCustomerId("");setNotes("");setLaborSessionId("");setLaborLoadCount("0");setError("");setCheckout(false);requestId.current=null;
 }
 function savedPrice(qualityId:string){
  const product=products.find(p=>p.product_qualities.some(q=>q.id===qualityId));
  const value=salesPriceDefault(product?.default_sales_price,prices.find(p=>p.center_id===centerId&&p.quality_id===qualityId)?.price);
  return Number.isFinite(value)&&value>0?Math.round(value*100)/100:0;
 }
 function addProduct(product:Product,qualityId:string){
  const stocked=locations.filter(l=>available(qualityId,l.id)-used(qualityId,l.id)>=0.001);
  const location=stocked.find(l=>l.is_default)??stocked[0];
  if(!stockReady||!location)return;
  const remaining=roundedQty(available(qualityId,location.id)-used(qualityId,location.id));
  const amount=Math.min(1,remaining),existing=lines.find(l=>l.quality_id===qualityId&&l.location_id===location.id);
  if(existing)setLines(old=>old.map(l=>l.key===existing.key?{...l,quantity:String(roundedQty(Number(l.quantity)+amount))}:l));
  else setLines(old=>[...old,{key:crypto.randomUUID(),product_id:product.id,quality_id:qualityId,location_id:location.id,quantity:String(amount),unit_price:savedPrice(qualityId)}]);
  setError("");
 }
 function changeLine(key:string,patch:Partial<Line>){setLines(old=>old.map(l=>l.key===key?{...l,...patch}:l));setError("");}
 function stepQty(line:Line,step:number){const max=available(line.quality_id,line.location_id)-used(line.quality_id,line.location_id)+Number(line.quantity);changeLine(line.key,{quantity:String(roundedQty(Math.max(0.001,Math.min(max,Number(line.quantity)+step))))});}
 function changePayment(key:string,patch:Partial<Payment>){setPayments(rows.map(p=>p.key===key?{...p,...patch}:p));setError("");}
 function exit(e:React.MouseEvent<HTMLAnchorElement>){if(busy||switchingDraft)e.preventDefault();}
 async function confirm(e:React.FormEvent){
  e.preventDefault();if(submitLock.current)return;
  if(!canConfirm){setError("Check stock, customer and payment allocations before confirming.");return;}
  submitLock.current=true;setBusy(true);setError("");
  const task:OfflinePosTask={requestId:requestId.current??=crypto.randomUUID(),scopeId,kind:"sale",createdAt:new Date().toISOString(),payload:{centerId,customerId,notes,laborSessionId:laborSessionId||null,laborLoadCount:Math.max(0,Number(laborLoadCount)||0),lines:lines.map(l=>({...l,quantity:Number(l.quantity)})),payments:rows.map(p=>({...p,amount:Number(p.amount)})),totalCents}};
  const queueForLater=async(message?:string)=>{try{await enqueuePosTask(task);await clearPosDraft(draftKey);setOfflineQueueError(message??"");setPendingTotal(totalCents/100);setOfflineQueued(true);window.dispatchEvent(new Event("centerpro-pos-queue"));}catch(storageError){const text=storageError instanceof Error?storageError.message:"This device could not save the offline sale.";setError(text);submitLock.current=false;setBusy(false);}};
  if(!navigator.onLine){await queueForLater();setBusy(false);return;}
  try{
   const {data,error}=await createClient().rpc("confirm_center_sale_with_labor",{p_request:task.requestId,p_center:centerId,p_customer:customerId||null,p_notes:notes,p_lines:task.payload.lines,p_payments:task.payload.payments,p_labor_session:task.payload.laborSessionId,p_load_count:task.payload.laborLoadCount});
   if(error)throw new Error(error.message);
   await deletePosTask(task.requestId).catch(()=>{});await clearPosDraft(draftKey).catch(()=>{});
   // Reload the stored receipt and cash/stock state after the atomic posting.
   // eslint-disable-next-line @next/next/no-location-assign-relative-destination
   window.location.assign("/dashboard/sales/"+data);
  }catch(e){const message=e instanceof Error?e.message:"Sale could not be saved. Please retry.";if(!navigator.onLine||/failed to fetch|network|timeout|load failed/i.test(message)){await queueForLater(message);setBusy(false);return;}setError(message);submitLock.current=false;setBusy(false);}
 }
 async function editPendingSale(){
  const tasks=await listPosTasks(scopeId,"sale");const task=tasks.find(item=>item.requestId===requestId.current)??tasks[0];if(!task?.needsCorrection)return;
  const saved=task.payload as {centerId:string;customerId:string;notes:string;laborSessionId?:string|null;laborLoadCount?:number;lines:Array<Line>;payments:Array<Payment&{amount:number|string}>};
  await deletePosTask(task.requestId);requestId.current=null;setCenterId(saved.centerId);setCustomerId(saved.customerId??"");setNotes(saved.notes??"");setLaborSessionId(saved.laborSessionId??"");setLaborLoadCount(String(saved.laborLoadCount??0));setLines(saved.lines.map(line=>({...line,quantity:String(line.quantity)})));setPayments(saved.payments.map(payment=>({...payment,amount:String(payment.amount)})));setCheckout(true);setOfflineQueueError("");setOfflineNeedsCorrection(false);setOfflineQueued(false);setError("The server did not post this sale. Review the details and confirm again.");
 }
 async function addCustomer(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(customerLock.current)return;customerLock.current=true;setCustomerBusy(true);setCustomerError("");
  const form=e.currentTarget,fd=new FormData(form);
  try{const name=String(fd.get("name")).trim(),phone=String(fd.get("phone")??""),address=String(fd.get("address")??"");const {data,error}=await createClient().rpc("create_sales_customer",{p_center:centerId,p_name:name,p_phone:phone,p_address:address});if(error)throw new Error(error.message);setCustomers(old=>[...old,{id:data,center_id:centerId,name,phone,address}]);setCustomerId(data);form.reset();setCustomerOpen(false);}
  catch(e){setCustomerError(e instanceof Error?e.message:"Customer could not be saved.");}finally{setCustomerBusy(false);customerLock.current=false;}
 }

 if(offlineQueued)return <div className="purchase-pos-full sales-pos-full"><header className="pos-topbar"><Link href="/dashboard/sales" className="pos-back"><ArrowLeft/><span>Sales</span></Link><div className="pos-brand"><b>CenterPro</b><small>Sales POS</small></div><OfflinePosStatus scopeId={scopeId} kind="sale"/></header><main className="pos-offline-pending"><article><CloudOff size={48}/><h1>Sale saved · waiting to sync</h1><p>This sale is stored on this device. It has <strong>not</strong> reduced stock, recorded payment or created an invoice yet. CenterPro will check current stock, selling prices and payment details when connected.</p><strong>{money(pendingTotal)}</strong>{offlineQueueError&&<p className="alert error" role="alert">Sync needs attention: {offlineQueueError}</p>}<p>Keep this device and account available until the bill opens after syncing.</p>{offlineNeedsCorrection&&<button className="ghost" onClick={()=>void editPendingSale()}>Review and edit saved sale</button>} <button className="primary" onClick={()=>window.dispatchEvent(new Event("centerpro-pos-queue"))}>Try sync now</button> <button className="ghost" onClick={()=>window.location.assign(`/dashboard/sales/new?draft=${crypto.randomUUID()}`)}>New sale</button> <Link className="ghost" href="/dashboard/sales">Sales workspace</Link></article></main></div>;
 return <div className="purchase-pos-full sales-pos-full">
  <header className="pos-topbar">
   <Link href="/dashboard/sales" className="pos-back" onClick={exit}><ArrowLeft/><span>Sales</span></Link>
   <div className="pos-brand"><b>CenterPro</b><small>Sales POS</small></div>
   <label><kbd>F4</kbd> Center<select ref={centerRef} aria-label="Sales center" value={centerId} disabled={busy||checkout||customerOpen} onChange={e=>changeCenter(e.target.value)}>{centers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
   <OfflinePosStatus scopeId={scopeId} kind="sale"/>
  </header>
  <nav className="purchase-order-topbar sales-order-topbar" aria-label="Sales drafts and view">
   <div className="purchase-order-current" title="Temporary draft reference. Official sale number assigned after confirmation."><span>Order</span><strong>{draftReference}</strong><small>Draft</small></div>
   <div className="purchase-order-tools">
    <label className="purchase-order-mode"><span className="purchase-order-mode-label">Sales view</span>
     <select aria-label="Sales view" value={entryMode} disabled={busy||switchingDraft||checkout} onChange={e=>changeEntryMode(e.target.value as "pos"|"detailed")}>
      <option value="pos">POS</option><option value="detailed">Detailed</option>
     </select>
    </label>
    <button type="button" className="purchase-order-icon" title="Open saved sales drafts" aria-label={`Open sales drafts (${heldDrafts.length} held)`} aria-expanded={showDraftMenu} aria-controls="sales-drafts-popover" disabled={!draftReady||switchingDraft||busy} onClick={()=>setShowDraftMenu(v=>!v)}><Layers3 size={19} aria-hidden="true"/>{heldDrafts.length>0&&<span className="purchase-order-count">{heldDrafts.length}</span>}</button>
    <button type="button" className="purchase-order-icon purchase-order-new" title="Hold current sale and start a new one" aria-label="Hold & new sale" disabled={!draftReady||switchingDraft||busy} onClick={()=>void switchSalesDraft()}><Plus size={21} aria-hidden="true"/></button>
   </div>
   {showDraftMenu&&<div id="sales-drafts-popover" className="purchase-drafts-popover" role="group" aria-label="Saved sales drafts">
    <div className="purchase-drafts-popover-head"><strong>Unfinished sales</strong><button type="button" aria-label="Close draft list" onClick={()=>setShowDraftMenu(false)}><X size={17}/></button></div>
    <div className="purchase-drafts-list">
     <div className="purchase-drafts-current"><strong>{draftReference}</strong><span>Current draft · {lines.length} lines</span></div>
     {heldDrafts.map(row=><button type="button" key={row.key} className="purchase-drafts-item" onClick={()=>void switchSalesDraft(row.key)}>
      <strong>{row.key===baseDraftKey?"D-0001":`D-${row.key.slice(baseDraftKey.length+1).replaceAll("-", "").slice(0,6).toUpperCase()}`}</strong>
      <span>{centers.find(c=>c.id===row.value.centerId)?.code??"Center"} · {initialCustomers.find(c=>c.id===row.value.customerId)?.name??"Walk-in"} · {row.value.lines.length} lines</span>
     </button>)}
     {!heldDrafts.length&&<p className="purchase-drafts-empty">No other unfinished sales on this device.</p>}
    </div>
    <small className="purchase-drafts-help">Drafts stay on this device until confirmed.</small>
   </div>}
  </nav>
  {!isOnline&&<div className="pos-offline-warning" role="status">Offline: this screen uses the last saved stock snapshot. A sale is only final after server stock and payment validation.</div>}
  {!checkout?(entryMode==="detailed"?<DetailedSalesEntry
   center={center} customers={customers} customerId={customerId} onCustomerChange={setCustomerId}
   onAddCustomer={()=>{setCustomerError("");setCustomerOpen(true);}} products={products} lines={lines}
   total={totalCents/100} unitTotals={unitTotals} canCheckout={canCheckout} stockReady={stockReady} stockError={stockError} error={error} isOnline={isOnline}
   onRetryStock={()=>{setStockError("");setStockReady(false);setRefresh(v=>v+1);}}
   availableSacks={(qualityId,locationId)=>stock.find(s=>s.quality_id===qualityId&&s.location_id===locationId)?.sacks} available={available} used={used} invalidLine={invalidLine} savedPrice={savedPrice}
   onAddProduct={addProduct} onUpdateLine={changeLine} onRemoveLine={key=>setLines(old=>old.filter(l=>l.key!==key))}
   onOpenPayment={()=>{setError("");setCheckout(true);}}
  />:<div className="pos-sale-screen">
   <section className="pos-products" aria-label="Sales products">
    <div className="pos-search"><Search aria-hidden="true"/><input ref={searchRef} autoFocus aria-label="Search products" placeholder="Search products, code or quality…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="Clear search" onClick={()=>{setSearch("");searchRef.current?.focus();}}><X/></button>}<kbd>F2</kbd></div>
    <nav className="pos-categories" aria-label="Product categories"><button className={category==="all"?"active":""} onClick={()=>setCategory("all")}>All products</button>{categories.map(c=><button key={c} className={category===c?"active":""} onClick={()=>setCategory(c)}>{c}</button>)}</nav>
    {!centers.length&&<p className="alert error">No active center is assigned to your account.</p>}
    {stockError?<div className="alert error" role="alert">{stockError} <button className="ghost" onClick={()=>{setStockError("");setStockReady(false);setRefresh(v=>v+1);}}>Retry stock</button></div>:!stockReady&&centerId?<p role="status">Loading center stock…</p>:null}
    {stockReady&&!locations.length&&<p className="alert error">This center needs an active stock location.</p>}
    <div className="pos-product-grid">{filtered.flatMap(p=>p.product_qualities.filter(q=>q.is_active).map(q=>{
     const remaining=locations.reduce((n,l)=>n+Math.max(0,available(q.id,l.id)-used(q.id,l.id)),0);
     const defaultPrice=savedPrice(q.id);
     return <button key={q.id} className="pos-product" disabled={!stockReady||remaining<0.001} onClick={()=>addProduct(p,q.id)} aria-label={"Add "+p.name+" "+q.name}><span>{p.code}</span><strong>{p.name}</strong><small>{q.name} · {p.unit_of_measure}</small><b>{defaultPrice?"Last price · "+money(defaultPrice):"Enter selling price"}</b><span className={"sales-stock "+(remaining<0.001?"empty":"")}>{stockReady?qty(remaining)+" "+p.unit_of_measure+" available":"Loading stock…"}</span><em>{remaining<0.001?"Out of stock":<><Plus size={15}/> Add to sale</>}</em></button>;
    }))}{!filtered.some(p=>p.product_qualities.some(q=>q.is_active))&&<p className="product-empty">No products match this search.</p>}</div>
   </section>
   <aside className="pos-cart" aria-label="Sale cart">
    <div className="pos-cart-head"><div><ShoppingCart/><strong>Current sale</strong></div><span>{lines.length} item{lines.length===1?"":"s"}</span></div>
    <div className="pos-cart-lines">{!lines.length?<div className="pos-empty-cart"><ShoppingCart/><strong>Your cart is empty</strong><span>Select a product to begin</span></div>:lines.map((l,index)=>{
     const p=products.find(p=>p.id===l.product_id),invalid=invalidLine(l);return <article className={"pos-cart-line "+(invalid?"sales-invalid":"")} key={l.key}>
      <div className="pos-line-title"><span>{index+1}</span><div><strong>{p?.name}</strong><small>{p?.product_qualities.find(q=>q.id===l.quality_id)?.name}</small></div><button aria-label={"Remove "+p?.name} onClick={()=>setLines(old=>old.filter(x=>x.key!==l.key))}><Trash2/></button></div>
      <label>Stock location<select aria-label={"Location for "+p?.name} value={l.location_id} onChange={e=>changeLine(l.key,{location_id:e.target.value})}>{locations.map(loc=><option key={loc.id} value={loc.id}>{loc.name} · {qty(available(l.quality_id,loc.id))} {p?.unit_of_measure}</option>)}</select></label>
      <div className="pos-line-values"><label>Quantity ({p?.unit_of_measure})<div className="pos-qty"><button aria-label={"Decrease "+p?.name+" quantity"} onClick={()=>stepQty(l,-1)}><Minus/></button><input aria-label={"Quantity for "+p?.name} type="number" min="0.001" step="0.001" value={l.quantity} onChange={e=>changeLine(l.key,{quantity:e.target.value})}/><button aria-label={"Increase "+p?.name+" quantity"} onClick={()=>stepQty(l,1)}><Plus/></button></div></label><label className="sales-unit-price">Selling price (LKR)<input aria-label={"Selling price for "+p?.name} type="number" min="0.01" max="999999999999.99" step="0.01" value={l.unit_price||""} placeholder="Enter price" onChange={e=>changeLine(l.key,{unit_price:Number(e.target.value)})}/></label></div>
      {p?.tracks_sacks&&<label>Sacks sold (available: {stock.find(s=>s.quality_id===l.quality_id&&s.location_id===l.location_id)?.sacks??"not counted"}; 0 for loose stock)<input aria-label={"Sacks for "+p.name} type="number" min="0" step="1" required value={l.sack_count??""} onChange={e=>changeLine(l.key,{sack_count:e.target.value===""?undefined:Number(e.target.value)})}/></label>}
      <div className="pos-line-total"><span>Available {qty(available(l.quality_id,l.location_id))} {p?.unit_of_measure}</span><strong>{money(cents(Number(l.quantity)*l.unit_price)/100)}</strong></div>
      {invalid&&<p className="sales-line-error">Check the price, available quantity and whole sack count (zero for loose stock).</p>}
     </article>;
    })}</div>
    <footer className="pos-cart-footer">{error&&<p className="alert error" role="alert">{error}</p>}<div><span><small>Total quantity</small><b>{unitTotals||"0"}</b></span><span><small>Total amount</small><strong>{money(totalCents/100)}</strong></span></div><button className="primary pos-payment-button" disabled={!canCheckout} onClick={()=>{setError("");setCheckout(true);}}><kbd>F9</kbd> Payment <ArrowRight size={18}/></button></footer>
   </aside>
  </div>):<div className="pos-payment-screen">
   <form id="sales-payment" ref={paymentForm} onSubmit={confirm} className="payment-card">
    <fieldset disabled={busy} className="sales-pos-fieldset"><button type="button" className="payment-back" onClick={()=>setCheckout(false)}><ArrowLeft/>Back to products</button><span className="eyebrow dark">FINAL STEP</span><h1>Split sales payment</h1><p>Allocate the sale total across your payment methods.</p>
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="payment-fields"><label>Customer<select aria-label="Sale customer" value={customerId} required={credit>0} onChange={e=>setCustomerId(e.target.value)}><option value="">Walk-in customer (no credit)</option>{customers.filter(c=>c.center_id===centerId).map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?" · "+c.phone:""}</option>)}</select></label><button type="button" className="ghost sales-add-customer" disabled={!isOnline} title={!isOnline?"Connect to add a customer":""} onClick={()=>{setCustomerError("");setCustomerOpen(true);}}><UserPlus size={17}/>Add customer</button>
    {laborSessions.some(s=>s.center_id===centerId)&&<div className="labor-pos-fields"><label>Labor session<select value={laborSessionId} onChange={e=>setLaborSessionId(e.target.value)}><option value="">No labor session</option>{laborSessions.filter(s=>s.center_id===centerId).map(s=><option key={s.id} value={s.id}>{s.title} · {s.session_date}</option>)}</select></label><label>Loads<input type="number" min="0" step="1" value={laborLoadCount} onChange={e=>setLaborLoadCount(e.target.value)}/></label></div>}
    {credit>0&&!customerId&&<p className="alert error">Select or add a customer for Credit.</p>}
    <div className="split-payments"><div className="split-payment-heading"><strong>Payment allocations</strong><button type="button" className="ghost" disabled={rows.length>=20||difference<=0} onClick={()=>setPayments([...rows,newPayment(Math.max(0,difference)/100,crypto.randomUUID())])}><Plus size={17}/>Add line</button></div>
    {rows.map((p,index)=>{const account=banks.find(b=>b.id===p.bank_account_id);return <section className="split-payment-line" key={p.key}><div className="split-payment-title"><b>Payment {index+1}</b>{rows.length>1&&<button type="button" aria-label={"Remove payment "+(index+1)} onClick={()=>setPayments(rows.filter(row=>row.key!==p.key))}><Trash2 size={16}/></button>}</div><div className="split-payment-grid">
     <label>Method<select aria-label={"Payment "+(index+1)+" method"} value={p.method} onChange={e=>changePayment(p.key,{method:e.target.value,bank_account_id:"",cheque_number:"",cheque_date:""})}>{Object.entries(methods).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
     <label>Amount (LKR)<input aria-label={"Payment "+(index+1)+" amount"} type="number" required min="0.01" step="0.01" value={p.amount} onChange={e=>changePayment(p.key,{amount:e.target.value})}/></label>
     {["bank_transfer","card","cheque"].includes(p.method)&&<><label className="wide">Bank account<select aria-label={"Payment "+(index+1)+" bank account"} required value={p.bank_account_id} onChange={e=>changePayment(p.key,{bank_account_id:e.target.value})}><option value="">Select active account</option>{banks.map(b=><option key={b.id} value={b.id}>{b.payment_banks?.name} · {b.account_number}</option>)}</select></label>{account&&<div className="bank-account-details wide"><span><small>Bank</small><b>{account.payment_banks?.name}</b></span><span><small>Branch</small><b>{account.branch_name}</b></span><span><small>Branch code</small><b>{account.branch_code}</b></span></div>}{!banks.length&&<p className="wide alert error">Ask admin to add an active bank account.</p>}</>}
     {p.method==="cheque"&&<><label>Cheque number<input aria-label={"Payment "+(index+1)+" cheque number"} required value={p.cheque_number} onChange={e=>changePayment(p.key,{cheque_number:e.target.value})}/></label><label>Cheque date<input aria-label={"Payment "+(index+1)+" cheque date"} required type="date" value={p.cheque_date} onChange={e=>changePayment(p.key,{cheque_date:e.target.value})}/></label></>}
     {p.method!=="credit"&&<label className="wide">Reference<input placeholder="Optional reference" value={p.reference} onChange={e=>changePayment(p.key,{reference:e.target.value})}/></label>}
    </div></section>;})}</div>
    <label>Notes<textarea placeholder="Optional sale notes" value={notes} onChange={e=>setNotes(e.target.value)}/></label></div></fieldset>
   </form>
   <aside className="payment-summary"><h2>Sales summary</h2><div className="summary-center"><small>Selling center</small><strong>{center?.code} · {center?.name}</strong></div><div className="summary-lines">{lines.map(l=>{const product=products.find(p=>p.id===l.product_id);return <div key={l.key}><span><b>{product?.name}</b><small>{product?.product_qualities.find(q=>q.id===l.quality_id)?.name} · {l.quantity} {product?.unit_of_measure}</small><small>{locations.find(x=>x.id===l.location_id)?.name}</small></span><strong>{money(cents(Number(l.quantity)*l.unit_price)/100)}</strong></div>;})}</div>
    <div className={"allocation-summary "+(difference===0?"balanced":"unbalanced")} aria-live="polite"><span><small>Sale total</small><b>{money(totalCents/100)}</b></span><span><small>Allocated</small><b>{money(allocated/100)}</b></span><span><small>Paid (excl. Credit)</small><b>{money((allocated-credit)/100)}</b></span><span><small>Credit balance</small><b>{money(credit/100)}</b></span><strong>{difference===0?"Allocations balanced":difference>0?money(difference/100)+" remaining":money(-difference/100)+" over-allocated"}</strong></div>
    <div className="summary-total"><span><small>Total quantity</small><b>{unitTotals}</b></span><span><small>Total amount</small><strong>{money(totalCents/100)}</strong></span></div>
    <DraftBill disabled={busy||!canCheckout} data={{organization:organizationName,title:"SALES BILL",date:new Date().toLocaleString("en-LK",{timeZone:"Asia/Colombo"}),center:(center?.code??"")+" · "+(center?.name??""),party:customers.find(c=>c.id===customerId)?.name??"Walk-in customer",user:userName,notes,total:totalCents/100,lines:lines.map(l=>{const p=products.find(p=>p.id===l.product_id);return {name:p?.name??"",quality:p?.product_qualities.find(q=>q.id===l.quality_id)?.name,quantity:Number(l.quantity),unit:p?.unit_of_measure??"",price:l.unit_price,total:cents(Number(l.quantity)*l.unit_price)/100};})}}/>
    <button form="sales-payment" type="submit" className="primary confirm-payment" disabled={busy||!canConfirm}><Check/>{busy?"Confirming…":"Confirm sale"}</button>
   </aside>
  </div>}
  <dialog ref={customerDialog} className="sales-customer-dialog" onCancel={e=>{if(customerBusy)e.preventDefault();else setCustomerOpen(false);}} onClose={()=>setCustomerOpen(false)}><form onSubmit={addCustomer}><div className="sales-dialog-heading"><h2>Add customer</h2><button type="button" className="ghost" aria-label="Close customer form" disabled={customerBusy} onClick={()=>setCustomerOpen(false)}><X/></button></div><p>{center?.code} · {center?.name}</p>{customerError&&<p className="alert error" role="alert">{customerError}</p>}<fieldset disabled={customerBusy} className="sales-pos-fieldset payment-fields"><label>Name<input ref={customerNameRef} name="name" required maxLength={200}/></label><label>Phone<input name="phone" type="tel" maxLength={40}/></label><label>Address<textarea name="address" maxLength={500}/></label><button className="primary">{customerBusy?"Saving…":"Save customer"}</button></fieldset></form></dialog>
 </div>;
}
