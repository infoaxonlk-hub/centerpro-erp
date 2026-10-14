"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Building2,Plus,Landmark,ArrowDownToLine,X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notify } from "@/components/feedback";

type Bank={id:string;code:string;name:string};
type Account={id:string;account_number:string;account_name:string|null;branch_name:string;branch_code:string;is_active:boolean;payment_banks:{code:string;name:string}|{code:string;name:string}[]|null;balance:number};
const currency=(n:number)=>new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"}).format(n);
const one=<T,>(v:T|T[]|null):T|null=>Array.isArray(v)?v[0]??null:v;
export function BankWorkspace({banks,initialAccounts,organizationId}:{banks:Bank[];initialAccounts:Account[];organizationId:string}){
 const fundingRequest=useRef<string|null>(null);
 const[accounts,setAccounts]=useState(initialAccounts);
 const[mode,setMode]=useState<"create"|"fund"|null>(null);
 const[accountId,setAccountId]=useState(initialAccounts.find(a=>a.is_active)?.id??"");
 const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 async function refresh(){
   const supabase=createClient();
   const {data,error}=await supabase.from("bank_accounts").select("id,account_number,account_name,branch_name,branch_code,is_active,payment_banks(code,name)").eq("organization_id",organizationId).order("created_at");
   if(error)throw error;
   const updated=await Promise.all(((data??[]) as Omit<Account,"balance">[]).map(async a=>{
     const {data:balance,error:err}=await supabase.rpc("bank_book_balance",{p_bank_account:a.id});if(err)throw err;
     return {...a,balance:Number(balance??0)};
   }));
   setAccounts(updated);
   setAccountId(current=>current||updated.find(a=>a.is_active)?.id||"");
 }
 async function submitCreate(fd:FormData){setBusy(true);setError("");try{
   const{error}=await createClient().from("bank_accounts").insert({organization_id:organizationId,bank_id:String(fd.get("bank")),account_number:String(fd.get("number")).trim(),account_name:String(fd.get("name")).trim()||null,branch_name:String(fd.get("branch")).trim(),branch_code:String(fd.get("branch_code")).trim()});
   if(error)throw error;await refresh();setMode(null);notify("Company bank account created");
 }catch(e){const msg=e instanceof Error?e.message:String(e);setError(msg);notify(msg,"error")}finally{setBusy(false)}}
 async function submitFunding(fd:FormData){setBusy(true);setError("");try{
   const account=String(fd.get("account"));const amount=Number(fd.get("amount"));
   if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)!==amount*100)throw new Error("Enter a valid amount with up to two decimal places");
   const{error}=await createClient().rpc("record_admin_bank_funding",{p_bank_account:account,p_amount:amount,p_source:String(fd.get("source")),p_details:String(fd.get("details")),p_reference:String(fd.get("reference")??""),p_request:(fundingRequest.current??=crypto.randomUUID()),p_value_date:String(fd.get("value_date")||"")||null});
   if(error)throw error;fundingRequest.current=null;await refresh();setMode(null);notify("Bank funding recorded in the statement");
 }catch(e){const msg=e instanceof Error?e.message:String(e);setError(msg);notify(msg,"error")}finally{setBusy(false)}}
 return <section className="bank-management">
   <div className="page-heading"><div><span className="eyebrow dark">BANK MANAGEMENT</span><h1>Bank Accounts</h1><p>One company bank account is shared by all centers. Purchases and sales use the same balance.</p></div></div>
   <div className="bank-actions"><button className="primary" type="button" onClick={()=>{setError("");setMode("create")}}><Plus size={17}/> Create bank account</button><button className="soft" type="button" disabled={!accounts.some(a=>a.is_active)} onClick={()=>{setError("");setAccountId(current=>current||accounts.find(a=>a.is_active)?.id||"");setMode("fund")}}><ArrowDownToLine size={17}/> Add bank funds</button></div>
   <div className="bank-account-grid">{accounts.map(a=>{const bank=one(a.payment_banks);return <article className="panel bank-card" key={a.id}>
    <div className="bank-card-head"><Landmark size={19}/><strong>{bank?.name??"Bank account"}</strong><span className={a.is_active?"bank-status-active":"bank-status-inactive"}>{a.is_active?"Active":"Inactive"}</span></div>
    <div className="bank-card-number">{a.account_number}</div><small>{a.account_name||"Company bank account"} · {a.branch_name}</small>
    <div className="bank-card-balance">{currency(a.balance)}</div><div className="bank-card-foot"><span>Shared company balance</span><Link href={`/dashboard/bank/statement?account=${a.id}`}>View statement →</Link></div>
   </article>})}{!accounts.length&&<p className="panel bank-empty">No bank accounts yet. Create your first company bank account.</p>}</div>
   <p className="bank-note">Bank transfers received from sales increase this balance; bank transfers and outbound card payments for purchases reduce it. Incoming cards and uncleared cheques are not posted as cleared bank funds.</p>
   {mode&&<div className="dialog-backdrop"><form className="dialog bank-dialog" action={mode==="create"?submitCreate:submitFunding}>
    <div className="dialog-head"><div><h2>{mode==="create"?"Create company bank account":"Add funds to company bank"}</h2><p>{mode==="fund"?"Record an actual deposit/opening bank balance. This affects the selected bank only. Do not re-enter a POS bank payment.":"The same bank account will be selectable at every center."}</p></div><button className="icon-btn" type="button" onClick={()=>setMode(null)}><X/></button></div>
    {error&&<div className="alert error">{error}</div>}
    {mode==="create"? <>
      <label>Bank<select name="bank" required defaultValue=""><option value="" disabled>Select bank</option>{banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <div className="form-grid"><label>Account number<input name="number" required maxLength={50}/></label><label>Account holder name<input name="name" maxLength={120}/></label><label>Branch<input name="branch" required maxLength={120}/></label><label>Branch code<input name="branch_code" required maxLength={40}/></label></div>
    </>:<>
      <label>Company bank account<select name="account" value={accountId} required onChange={e=>setAccountId(e.target.value)}>{accounts.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{one(a.payment_banks)?.name} — {a.account_number}</option>)}</select></label>
      <label>Amount (LKR)<input type="number" name="amount" required min="0.01" step="0.01"/></label>
      <label>Source<select name="source" required defaultValue="opening_balance"><option value="opening_balance">Opening balance before imported transactions</option><option value="owner_contribution">Owner contribution</option><option value="external_deposit">External bank deposit</option><option value="other">Other verified incoming funds</option></select></label>
      <label>Description<input name="details" required maxLength={500} placeholder="Reason / origin of funds"/></label>
      <label>Posting date (optional, for historical opening balances)<input type="date" name="value_date"/></label>
      <label>Bank transaction reference<input name="reference" maxLength={120} placeholder="Reference / receipt number (optional)"/></label>
    </>}
    <div className="dialog-actions"><button type="button" className="ghost" onClick={()=>setMode(null)}>Cancel</button><button type="submit" className="primary" disabled={busy}><Building2 size={16}/>{busy?"Saving…":mode==="create"?"Create account":"Record bank deposit"}</button></div>
   </form></div>}
 </section>;
}
