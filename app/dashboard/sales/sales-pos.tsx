"use client";

import Link from "next/link";
import {DraftBill} from "@/components/draft-bill";
import {useEffect,useRef,useState} from "react";
import {ArrowLeft,ArrowRight,Check,Minus,Plus,Search,ShoppingCart,Trash2,UserPlus,X} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {Bank,Center,Customer,Line,Payment,Price,Product,Stock,cents,methods,money} from "./types";
import "./sales-pos.css";

type Props={centers:Center[];customers:Customer[];products:Product[];prices:Price[];banks:Bank[];organizationName?:string;userName?:string};
const newPayment=(amount:number,key="initial"):Payment=>({key,method:"cash",amount:amount.toFixed(2),bank_account_id:"",reference:"",cheque_number:"",cheque_date:""});
const qty=(n:number)=>n.toLocaleString("en-LK",{maximumFractionDigits:3});
const roundedQty=(n:number)=>Math.round(n*1000)/1000;

export function SalesPOS({centers,customers:initialCustomers,products,prices,banks,organizationName="CenterPro",userName}:Props){
 const [centerId,setCenterId]=useState(centers[0]?.id??"");
 const [stock,setStock]=useState<Stock[]>([]),[stockReady,setStockReady]=useState(false),[stockError,setStockError]=useState(""),[refresh,setRefresh]=useState(0);
 const [lines,setLines]=useState<Line[]>([]),[search,setSearch]=useState(""),[category,setCategory]=useState("all"),[checkout,setCheckout]=useState(false);
 const [payments,setPayments]=useState<Payment[]>([]),[customerId,setCustomerId]=useState(""),[customers,setCustomers]=useState(initialCustomers),[notes,setNotes]=useState("");
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[customerBusy,setCustomerBusy]=useState(false),[customerError,setCustomerError]=useState(""),[customerOpen,setCustomerOpen]=useState(false);
 const requestId=useRef<string|null>(null),submitLock=useRef(false),customerLock=useRef(false);
 const searchRef=useRef<HTMLInputElement>(null),centerRef=useRef<HTMLSelectElement>(null),paymentForm=useRef<HTMLFormElement>(null),customerDialog=useRef<HTMLDialogElement>(null),customerNameRef=useRef<HTMLInputElement>(null);
 const center=centers.find(c=>c.id===centerId);
 const locations=(center?.locations??[]).filter(l=>l.is_active&&(center?.allow_multiple_locations||l.is_default));
 const categories=[...new Set(products.map(p=>p.category?.trim()||"Uncategorized"))].sort();
 const priceFor=(qualityId:string)=>Number(prices.find(p=>p.center_id===centerId&&p.quality_id===qualityId)?.price??0);
 const available=(qualityId:string,locationId:string)=>Number(stock.find(s=>s.quality_id===qualityId&&s.location_id===locationId)?.quantity??0);
 const used=(qualityId:string,locationId:string)=>lines.filter(l=>l.quality_id===qualityId&&l.location_id===locationId).reduce((n,l)=>n+Number(l.quantity),0);
 const totalCents=lines.reduce((n,l)=>n+cents(Number(l.quantity)*l.unit_price),0);
 const rows=payments.length?payments:[newPayment(totalCents/100)];
 const allocated=rows.reduce((n,p)=>n+cents(Number(p.amount)),0),credit=rows.filter(p=>p.method==="credit").reduce((n,p)=>n+cents(Number(p.amount)),0);
 const difference=totalCents-allocated;
 const invalidLine=(l:Line)=>!l.location_id||!Number.isFinite(Number(l.quantity))||Number(l.quantity)<=0||Math.abs(roundedQty(Number(l.quantity))-Number(l.quantity))>0.0000001||roundedQty(used(l.quality_id,l.location_id))>roundedQty(available(l.quality_id,l.location_id))||cents(Number(l.quantity)*l.unit_price)<=0;
 const cartInvalid=lines.some(invalidLine);
 const canCheckout=stockReady&&lines.length>0&&!cartInvalid&&Number.isFinite(totalCents)&&totalCents>0;
 const canConfirm=canCheckout&&difference===0&&rows.every(p=>Number.isFinite(Number(p.amount))&&Number(p.amount)>0)&&(!credit||!!customerId);
 const unitTotals=[...lines.reduce((totals,l)=>{const unit=products.find(p=>p.id===l.product_id)?.unit_of_measure??"";totals.set(unit,(totals.get(unit)??0)+Number(l.quantity));return totals;},new Map<string,number>())].map(([unit,n])=>qty(n)+" "+unit).join(" · ");
 const filtered=products.filter(p=>(category==="all"||(p.category?.trim()||"Uncategorized")===category)&&[p.name,p.code,...p.product_qualities.map(q=>q.name)].join(" ").toLowerCase().includes(search.trim().toLowerCase()));

 useEffect(()=>{
  let cancelled=false;if(!centerId)return;
  async function load(){try{const {data,error}=await createClient().rpc("sales_stock",{p_center:centerId});if(cancelled)return;if(error){setStockError(error.message);return;}setStock(data??[]);setStockReady(true);}catch{if(!cancelled)setStockError("Unable to load stock. Check your connection and retry.");}}
  void load();return()=>{cancelled=true};
 },[centerId,refresh]);
 useEffect(()=>{
  function keydown(e:KeyboardEvent){
   if(busy||customerOpen||e.altKey||e.ctrlKey||e.metaKey)return;
   if(e.key==="F2"&&!checkout){e.preventDefault();searchRef.current?.focus();}
   if(e.key==="F4"&&!checkout){e.preventDefault();centerRef.current?.focus();}
   if(e.key==="F9"&&!checkout){e.preventDefault();if(canCheckout){setError("");setCheckout(true);}}
   if(e.key==="F10"&&checkout){e.preventDefault();if(canConfirm)paymentForm.current?.requestSubmit();}
   if(e.key==="Escape"&&checkout){e.preventDefault();setCheckout(false);}
  }
  window.addEventListener("keydown",keydown);return()=>window.removeEventListener("keydown",keydown);
 },[busy,customerOpen,checkout,canCheckout,canConfirm]);
 useEffect(()=>{if(customerOpen){customerDialog.current?.showModal();customerNameRef.current?.focus();}else customerDialog.current?.close();},[customerOpen]);

 function changeCenter(id:string){
  if(id===centerId)return;
  if(lines.length&&!window.confirm("Change center and clear this sale?"))return;
  setCenterId(id);setStock([]);setStockReady(false);setStockError("");setLines([]);setPayments([]);setCustomerId("");setNotes("");setError("");setCheckout(false);requestId.current=null;
 }
 function addProduct(product:Product,qualityId:string){
  const stocked=locations.filter(l=>available(qualityId,l.id)-used(qualityId,l.id)>=0.001);
  const location=stocked.find(l=>l.is_default)??stocked[0];
  if(!stockReady||!location||!priceFor(qualityId))return;
  const remaining=roundedQty(available(qualityId,location.id)-used(qualityId,location.id));
  const amount=Math.min(1,remaining),existing=lines.find(l=>l.quality_id===qualityId&&l.location_id===location.id);
  if(existing)setLines(old=>old.map(l=>l.key===existing.key?{...l,quantity:String(roundedQty(Number(l.quantity)+amount))}:l));
  else setLines(old=>[...old,{key:crypto.randomUUID(),product_id:product.id,quality_id:qualityId,location_id:location.id,quantity:String(amount),unit_price:priceFor(qualityId)}]);
  setError("");
 }
 function changeLine(key:string,patch:Partial<Line>){setLines(old=>old.map(l=>l.key===key?{...l,...patch}:l));setError("");}
 function stepQty(line:Line,step:number){const max=available(line.quality_id,line.location_id)-used(line.quality_id,line.location_id)+Number(line.quantity);changeLine(line.key,{quantity:String(roundedQty(Math.max(0.001,Math.min(max,Number(line.quantity)+step))))});}
 function changePayment(key:string,patch:Partial<Payment>){setPayments(rows.map(p=>p.key===key?{...p,...patch}:p));setError("");}
 function exit(e:React.MouseEvent<HTMLAnchorElement>){if(busy||(lines.length&&!window.confirm("Leave this sale? Unsaved items will be lost.")))e.preventDefault();}
 async function confirm(e:React.FormEvent){
  e.preventDefault();if(submitLock.current)return;
  if(!canConfirm){setError("Check stock, customer and payment allocations before confirming.");return;}
  submitLock.current=true;setBusy(true);setError("");
  try{
   requestId.current??=crypto.randomUUID();
   const {data,error}=await createClient().rpc("confirm_center_sale",{p_request:requestId.current,p_center:centerId,p_customer:customerId||null,p_notes:notes,p_lines:lines.map(l=>({...l,quantity:Number(l.quantity)})),p_payments:rows.map(p=>({...p,amount:Number(p.amount)}))});
   if(error)throw new Error(error.message);
   // Reload the stored receipt and cash/stock state after the atomic posting.
   // eslint-disable-next-line @next/next/no-location-assign-relative-destination
   window.location.assign("/dashboard/sales/"+data);
  }catch(e){setError(e instanceof Error?e.message:"Sale could not be saved. Please retry.");submitLock.current=false;setBusy(false);}
 }
 async function addCustomer(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(customerLock.current)return;customerLock.current=true;setCustomerBusy(true);setCustomerError("");
  const form=e.currentTarget,fd=new FormData(form);
  try{const name=String(fd.get("name")).trim(),phone=String(fd.get("phone")??""),address=String(fd.get("address")??"");const {data,error}=await createClient().rpc("create_sales_customer",{p_center:centerId,p_name:name,p_phone:phone,p_address:address});if(error)throw new Error(error.message);setCustomers(old=>[...old,{id:data,center_id:centerId,name,phone,address}]);setCustomerId(data);form.reset();setCustomerOpen(false);}
  catch(e){setCustomerError(e instanceof Error?e.message:"Customer could not be saved.");}finally{setCustomerBusy(false);customerLock.current=false;}
 }

 return <div className="purchase-pos-full sales-pos-full">
  <header className="pos-topbar">
   <Link href="/dashboard/sales" className="pos-back" onClick={exit}><ArrowLeft/><span>Sales</span></Link>
   <div className="pos-brand"><b>CenterPro</b><small>Sales POS</small></div>
   <label><kbd>F4</kbd> Center<select ref={centerRef} aria-label="Sales center" value={centerId} disabled={busy||checkout||customerOpen} onChange={e=>changeCenter(e.target.value)}>{centers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
  </header>
  {!checkout?<div className="pos-sale-screen">
   <section className="pos-products" aria-label="Sales products">
    <div className="pos-search"><Search aria-hidden="true"/><input ref={searchRef} autoFocus aria-label="Search products" placeholder="Search products, code or quality…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="Clear search" onClick={()=>{setSearch("");searchRef.current?.focus();}}><X/></button>}<kbd>F2</kbd></div>
    <nav className="pos-categories" aria-label="Product categories"><button className={category==="all"?"active":""} onClick={()=>setCategory("all")}>All products</button>{categories.map(c=><button key={c} className={category===c?"active":""} onClick={()=>setCategory(c)}>{c}</button>)}</nav>
    {!centers.length&&<p className="alert error">No active center is assigned to your account.</p>}
    {stockError?<div className="alert error" role="alert">{stockError} <button className="ghost" onClick={()=>{setStockError("");setStockReady(false);setRefresh(v=>v+1);}}>Retry stock</button></div>:!stockReady&&centerId?<p role="status">Loading center stock…</p>:null}
    {stockReady&&!locations.length&&<p className="alert error">This center needs an active stock location.</p>}
    <div className="pos-product-grid">{filtered.flatMap(p=>p.product_qualities.filter(q=>q.is_active).map(q=>{
     const remaining=locations.reduce((n,l)=>n+Math.max(0,available(q.id,l.id)-used(q.id,l.id)),0),price=priceFor(q.id);
     return <button key={q.id} className="pos-product" disabled={!stockReady||!price||remaining<0.001} onClick={()=>addProduct(p,q.id)} aria-label={"Add "+p.name+" "+q.name}><span>{p.code}</span><strong>{p.name}</strong><small>{q.name} · {p.unit_of_measure}</small><b>{price?money(price):"Price not set"}</b><span className={"sales-stock "+(remaining<0.001?"empty":"")}>{stockReady?qty(remaining)+" "+p.unit_of_measure+" available":"Loading stock…"}</span><em>{!price?"Ask admin to set a selling price":remaining<0.001?"Out of stock":<><Plus size={15}/> Add to sale</>}</em></button>;
    }))}{!filtered.some(p=>p.product_qualities.some(q=>q.is_active))&&<p className="product-empty">No products match this search.</p>}</div>
   </section>
   <aside className="pos-cart" aria-label="Sale cart">
    <div className="pos-cart-head"><div><ShoppingCart/><strong>Current sale</strong></div><span>{lines.length} item{lines.length===1?"":"s"}</span></div>
    <div className="pos-cart-lines">{!lines.length?<div className="pos-empty-cart"><ShoppingCart/><strong>Your cart is empty</strong><span>Select a product to begin</span></div>:lines.map((l,index)=>{
     const p=products.find(p=>p.id===l.product_id),invalid=invalidLine(l);return <article className={"pos-cart-line "+(invalid?"sales-invalid":"")} key={l.key}>
      <div className="pos-line-title"><span>{index+1}</span><div><strong>{p?.name}</strong><small>{p?.product_qualities.find(q=>q.id===l.quality_id)?.name}</small></div><button aria-label={"Remove "+p?.name} onClick={()=>setLines(old=>old.filter(x=>x.key!==l.key))}><Trash2/></button></div>
      <label>Stock location<select aria-label={"Location for "+p?.name} value={l.location_id} onChange={e=>changeLine(l.key,{location_id:e.target.value})}>{locations.map(loc=><option key={loc.id} value={loc.id}>{loc.name} · {qty(available(l.quality_id,loc.id))} {p?.unit_of_measure}</option>)}</select></label>
      <div className="pos-line-values"><label>Quantity ({p?.unit_of_measure})<div className="pos-qty"><button aria-label={"Decrease "+p?.name+" quantity"} onClick={()=>stepQty(l,-1)}><Minus/></button><input aria-label={"Quantity for "+p?.name} type="number" min="0.001" step="0.001" value={l.quantity} onChange={e=>changeLine(l.key,{quantity:e.target.value})}/><button aria-label={"Increase "+p?.name+" quantity"} onClick={()=>stepQty(l,1)}><Plus/></button></div></label><div className="sales-unit-price"><small>Unit price</small><b>{money(l.unit_price)}</b></div></div>
      <div className="pos-line-total"><span>Available {qty(available(l.quality_id,l.location_id))} {p?.unit_of_measure}</span><strong>{money(cents(Number(l.quantity)*l.unit_price)/100)}</strong></div>
      {invalid&&<p className="sales-line-error">Enter a valid quantity within this location’s available stock.</p>}
     </article>;
    })}</div>
    <footer className="pos-cart-footer">{error&&<p className="alert error" role="alert">{error}</p>}<div><span><small>Total quantity</small><b>{unitTotals||"0"}</b></span><span><small>Total amount</small><strong>{money(totalCents/100)}</strong></span></div><button className="primary pos-payment-button" disabled={!canCheckout} onClick={()=>{setError("");setCheckout(true);}}><kbd>F9</kbd> Payment <ArrowRight size={18}/></button></footer>
   </aside>
  </div>:<div className="pos-payment-screen">
   <form id="sales-payment" ref={paymentForm} onSubmit={confirm} className="payment-card">
    <fieldset disabled={busy} className="sales-pos-fieldset"><button type="button" className="payment-back" onClick={()=>setCheckout(false)}><ArrowLeft/>Back to products</button><span className="eyebrow dark">FINAL STEP</span><h1>Split sales payment</h1><p>Allocate the sale total across your payment methods.</p>
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="payment-fields"><label>Customer<select aria-label="Sale customer" value={customerId} required={credit>0} onChange={e=>setCustomerId(e.target.value)}><option value="">Walk-in customer (no credit)</option>{customers.filter(c=>c.center_id===centerId).map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?" · "+c.phone:""}</option>)}</select></label><button type="button" className="ghost sales-add-customer" onClick={()=>{setCustomerError("");setCustomerOpen(true);}}><UserPlus size={17}/>Add customer</button>
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
