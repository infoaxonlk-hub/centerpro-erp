"use client";

import {useState} from "react";
import {ArrowDownRight, ArrowUpRight, Banknote, CheckCircle2, Landmark, Wallet} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {notify} from "@/components/feedback";
import "./unified-cash.css";

type Center={id:string;code:string;name:string};
type Account={id:string;kind:string;center_id:string|null;name:string;balance:number|null};
type Issue={id:string;center_id:string;reference:string;purchase_issued:number;expense_issued:number;purchase_received:number|null;expense_received:number|null;status:string;receipt_note:string|null;issued_at:string;received_at:string|null;centers:Center|Center[]|null};
type CashIn={id:string;amount:number;source:string;source_details:string;created_at:string};
type JournalEntry={id:string;debit_account_id:string;credit_account_id:string;amount:number;source_table:string;posting_key:string;note:string|null;created_at:string};
const currency=(n:number)=>new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"}).format(n);
const one=<T,>(x:T|T[]|null)=>Array.isArray(x)?x[0]:x;

export function UnifiedCash({isAdmin,centers,issues,cashIns,accounts,entries}:{isAdmin:boolean;centers:Center[];issues:Issue[];cashIns:CashIn[];accounts:Account[];entries:JournalEntry[]}){
 const [mode,setMode]=useState<"in"|"issue">("issue"),[busy,setBusy]=useState(false);
 const [purchase,setPurchase]=useState(""),[expense,setExpense]=useState("");
 const main=accounts.find(a=>a.kind==="admin_main");
 const transit=accounts.find(a=>a.kind==="in_transit");
 const centerAccounts=accounts.filter(a=>a.kind==="center");
 const available=Number(main?.balance??0);
 const run=async(fn:()=>PromiseLike<{error:{message:string}|null}>,message:string)=>{
  setBusy(true);
  try{const {error}=await fn();if(error)throw error;notify(message,"success");window.location.reload()}
  catch(e){notify(e instanceof Error?e.message:String(e),"error")}
  finally{setBusy(false)}
 };
 const cashIn=(fd:FormData)=>run(()=>createClient().rpc("record_admin_cash_in",{p_amount:Number(fd.get("amount")),p_source:String(fd.get("source")),p_details:String(fd.get("details"))}),"Cash added to Admin Main Cash");
 const issue=(fd:FormData)=>run(()=>createClient().rpc("issue_combined_center_cash",{p_center:String(fd.get("center")),p_purchase:Number(fd.get("purchase")||0),p_expense:Number(fd.get("expense")||0),p_reference:String(fd.get("reference"))}),"Cash issued; pending center receipt");
 const receive=(id:string,fd:FormData)=>run(()=>createClient().rpc("receive_center_cash_with_note",{p_issue:id,p_purchase:Number(fd.get("purchase")),p_expense:Number(fd.get("expense")),p_note:String(fd.get("note")??"")}),"Cash receipt confirmed");
 const centerName=(id:string)=>{const c=centers.find(x=>x.id===id);return c?`${c.code} · ${c.name}`:"Center"};
 const pending=issues.filter(i=>i.status==="pending");
 return <section className="unified-cash">
  <header className="page-heading"><div><span className="eyebrow dark">CASH ACCOUNTS</span><h1>{isAdmin?"Admin & center cash accounts":"My center cash"}</h1><p>{isAdmin?"Fund Admin Main Cash and transfer to a center. Every movement posts a balanced debit and credit.":"Only your assigned center cash accounts are visible. Confirm cash received here."}</p></div></header>
  <div className="cash-account-cards">
   {isAdmin&&<article className="cash-account-card cash-account-main"><span><Landmark size={18}/> Admin Main Cash</span><strong>{main?.balance==null?"Unavailable":currency(available)}</strong><small>Source cash for center transfers</small></article>}
   {isAdmin&&<article className="cash-account-card"><span><ArrowUpRight size={18}/> Cash awaiting receipt</span><strong>{transit?.balance==null?"Unavailable":currency(Number(transit.balance))}</strong><small>Issued but not yet acknowledged</small></article>}
   {centerAccounts.map(a=><article key={a.id} className="cash-account-card"><span><Wallet size={18}/>{centerName(a.center_id??"")}</span><strong>{a.balance==null?"Unavailable":currency(Number(a.balance))}</strong><small>Purchases and cash expenses use this account</small></article>)}
   {!centerAccounts.length&&<article className="cash-account-card"><span>No center account assigned</span><small>Ask the administrator to assign an active center.</small></article>}
  </div>
  {isAdmin&&<section className="panel"><div className="cash-action-tabs"><button type="button" className={mode==="issue"?"primary":"ghost"} onClick={()=>setMode("issue")}>Issue to center</button><button type="button" className={mode==="in"?"primary":"ghost"} onClick={()=>setMode("in")}>Add Cash In</button></div>
   {mode==="in"?<form className="cash-action-form" action={cashIn}><h2>Admin Main Cash · Money In</h2><label>Amount (LKR)<input required min="0.01" step="0.01" type="number" name="amount"/></label><label>Source<select required name="source"><option value="owner_cash">Owner / business funding</option><option value="bank_withdrawal">Bank withdrawal</option><option value="other">Other</option></select></label><label className="wide">Source details / reference<input required name="details" placeholder="Opening cash or deposit reference"/></label><p className="wide cash-help">Bank withdrawal is a reference only; it does not automatically update the bank balance.</p><button className="primary wide" disabled={busy}>{busy?"Saving…":"Record Cash In"}</button></form>
   :<form className="cash-action-form" action={issue}><h2>Transfer · Admin Main → Center Cash</h2><label>Destination center<select name="center" required defaultValue=""><option value="" disabled>Select center</option>{centers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label><label>Reference<input name="reference" required placeholder="e.g. CASH-2026-001"/></label><label>For purchases (LKR)<input name="purchase" type="number" min="0" step="0.01" value={purchase} onChange={e=>setPurchase(e.target.value)}/></label><label>For expenses (LKR)<input name="expense" type="number" min="0" step="0.01" value={expense} onChange={e=>setExpense(e.target.value)}/></label><div className="cash-total wide">Total transfer <strong>{currency(Number(purchase||0)+Number(expense||0))}</strong></div><p className="wide cash-help">Both amounts reach the SAME center cash account after receipt. They are split here only for receipt details. The center must acknowledge before the account is credited.</p><button className="primary wide" disabled={busy||Number(purchase||0)+Number(expense||0)<=0||Number(purchase||0)+Number(expense||0)>available}>{busy?"Issuing…":"Issue cash for receipt"}</button></form>}
  </section>}
  <section className="panel"><div className="cash-section-heading"><div><h2>Cash awaiting receipt</h2><p>{isAdmin?"Admin and the assigned center user can confirm an issued amount.":"Count the physical cash and confirm the amount actually received."}</p></div><strong>{pending.length} pending</strong></div><div className="cash-receive-grid">{pending.map(i=><ReceiveCard key={i.id} issue={i} busy={busy} receive={receive}/>)}{!pending.length&&<p>No pending cash handovers.</p>}</div></section>
  <section className="panel table-panel"><h2>Cash transfer history</h2><div className="cash-table-scroll"><table><thead><tr><th>Issued</th><th>Center / reference</th><th>Issued amount</th><th>Received amount</th>{isAdmin&&<th>Difference</th>}<th>Status</th><th>Receipt note</th></tr></thead><tbody>{issues.map(i=>{const expected=Number(i.purchase_issued)+Number(i.expense_issued),actual=Number(i.purchase_received)+Number(i.expense_received),diff=i.status==="received"?actual-expected:null;return <tr key={i.id}><td>{new Date(i.issued_at).toLocaleString("en-LK")}</td><td>{centerName(i.center_id)}<small>{i.reference}</small></td><td>{currency(expected)}</td><td>{i.status==="received"?currency(actual):"—"}</td>{isAdmin&&<td className={diff?"cash-difference":""}>{diff===null?"—":currency(diff)}</td>}<td><span className={`handover-status ${i.status}`}>{i.status}</span></td><td>{i.receipt_note||"—"}</td></tr>})}{!issues.length&&<tr><td colSpan={isAdmin?7:6}>No cash transfers yet.</td></tr>}</tbody></table></div></section>
  {isAdmin&&<section className="panel table-panel"><h2>Admin Cash In history</h2><div className="cash-table-scroll"><table><thead><tr><th>Date</th><th>Source</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{cashIns.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleString("en-LK")}</td><td>{x.source.replaceAll("_"," ")}</td><td>{x.source_details}</td><td>{currency(Number(x.amount))}</td></tr>)}{!cashIns.length&&<tr><td colSpan={4}>No Cash In records yet.</td></tr>}</tbody></table></div></section>}
  <section className="panel table-panel"><h2>{isAdmin?"Recent cash debit / credit postings":"My center cash movements"}</h2><p>Debit increases the account; credit reduces it. Every row posts the same amount on both sides.</p><div className="cash-table-scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Debit (in)</th><th>Credit (out)</th><th>Amount</th><th>Details</th></tr></thead><tbody>{entries.map(e=>{const debit=accounts.find(a=>a.id===e.debit_account_id),credit=accounts.find(a=>a.id===e.credit_account_id);return <tr key={e.id}><td>{new Date(e.created_at).toLocaleString("en-LK")}</td><td>{e.source_table.replaceAll("_"," ")}</td><td>{debit?.name??"Control / external"}</td><td>{credit?.name??"Control / external"}</td><td>{currency(Number(e.amount))}</td><td>{e.note??e.posting_key}</td></tr>})}{!entries.length&&<tr><td colSpan={6}>No cash movements yet.</td></tr>}</tbody></table></div></section>
 </section>
}
function ReceiveCard({issue,busy,receive}:{issue:Issue;busy:boolean;receive:(id:string,fd:FormData)=>Promise<void>}){
 const [purchase,setPurchase]=useState(String(issue.purchase_issued)),[expense,setExpense]=useState(String(issue.expense_issued));
 const expected=Number(issue.purchase_issued)+Number(issue.expense_issued);
 const actual=Number(purchase||0)+Number(expense||0);
 const mismatch=Number(purchase)!==Number(issue.purchase_issued)||Number(expense)!==Number(issue.expense_issued);
 const c=one(issue.centers);
 return <form className="cash-receive-card" action={fd=>receive(issue.id,fd)}><h3><Banknote size={17}/> {c?.code} · {c?.name}</h3><small>{issue.reference} · Issued {new Date(issue.issued_at).toLocaleString("en-LK")}</small><div className="cash-receive-amounts"><div>Purchase issued<strong>{currency(Number(issue.purchase_issued))}</strong></div><div>Expense issued<strong>{currency(Number(issue.expense_issued))}</strong></div><label>Purchase received<input required name="purchase" type="number" min="0" step="0.01" value={purchase} onChange={e=>setPurchase(e.target.value)}/></label><label>Expense received<input required name="expense" type="number" min="0" step="0.01" value={expense} onChange={e=>setExpense(e.target.value)}/></label></div><div className="cash-total"><span>Actual received</span><b>{currency(actual)}</b></div>{mismatch&&<p className="cash-generic-warning" role="alert">Difference from the issued amount. Please verify the count and provide a reason.</p>}{mismatch&&<label>Reason for cash difference<input name="note" required maxLength={400} placeholder="Required: explain shortage or overage"/></label>}<button className="primary" disabled={busy}><CheckCircle2 size={16}/>{busy?"Saving…":"Confirm receipt"}</button></form>
}
