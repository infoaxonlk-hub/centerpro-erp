"use client";

import Link from "next/link";
import {useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {notify} from "@/components/feedback";

type Rel<T> = T | T[] | null;
type ReturnLine = {product_name:string;quality_name:string;unit:string;quantity:number;line_total:number};
type ReturnRequest = {id:string;bill_type:string;bill_id:string;bill_number:string;reason:string;total_amount:number;applied_to_due:number;unapplied_credit:number;status:string;requested_at:string;review_note:string|null;centers:Rel<{code:string;name:string}>;profiles:Rel<{full_name:string}>;bill_return_lines:ReturnLine[]};
const one=<T,>(value:Rel<T>)=>Array.isArray(value)?value[0]??null:value;
const money=new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"});

export function ReturnRequestQueue({requests}:{requests:ReturnRequest[]}){
 const [busy,setBusy]=useState("");
 async function review(id:string,approve:boolean){
  if(approve&&!window.confirm("Approve this return? It will change stock and apply the credit note to the bill due."))return;
  setBusy(id);
  const {error}=await createClient().rpc("review_bill_return",{p_return:id,p_approve:approve,p_note:null});
  setBusy("");
  if(error)return notify(error.message,"error");
  notify(approve?"Return approved":"Return request rejected");
  window.location.reload();
 }
 return <>
  <div className="page-heading"><div><span className="eyebrow dark">ADMIN APPROVALS</span><h1>Sales &amp; purchase returns</h1><p>Review item quantities. Approval updates stock and applies the credit note to the bill balance first.</p></div></div>
  <div className="return-queue">{requests.map(request=>{
   const center=one(request.centers),user=one(request.profiles);
   return <article className="panel return-card" key={request.id}>
    <header className="return-card-heading"><div><span className={`status ${request.status==="approved"?"active":request.status==="rejected"?"inactive":"pending"}`}>{request.status}</span><h2>{request.bill_type==="sale"?"Sales return":"Purchase return"}</h2><p>{new Date(request.requested_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"})} · {center?.code} · {center?.name} · {user?.full_name}</p></div><Link className="ghost" href={request.bill_type==="sale"?`/dashboard/sales/${request.bill_id}`:`/dashboard/purchases/${request.bill_id}`}>{request.bill_number}</Link></header>
    <p className="return-reason"><strong>Reason:</strong> {request.reason}</p>
    <div className="table-panel"><table><thead><tr><th>Item</th><th>Quality</th><th>Return quantity</th><th className="number">Credit value</th></tr></thead><tbody>{request.bill_return_lines.map((line,index)=><tr key={`${request.id}-${index}`}><td>{line.product_name}</td><td>{line.quality_name}</td><td>{Number(line.quantity)} {line.unit}</td><td className="number">{money.format(Number(line.line_total))}</td></tr>)}</tbody></table></div>
    <div className="return-card-footer"><div><span>Return total</span><strong>{money.format(Number(request.total_amount))}</strong>{request.status==="approved"&&<small>Applied to due: {money.format(Number(request.applied_to_due))} · Unapplied credit note: {money.format(Number(request.unapplied_credit))}</small>}{request.review_note&&<small>Review note: {request.review_note}</small>}</div>{request.status==="pending"&&<div className="return-card-actions"><button className="ghost" disabled={busy===request.id} onClick={()=>review(request.id,false)}>Reject</button><button className="primary" disabled={busy===request.id} onClick={()=>review(request.id,true)}>{busy===request.id?"Saving…":"Approve return"}</button></div>}</div>
   </article>;
  })}{!requests.length&&<section className="panel empty-state"><div className="empty-icon">↩</div><h2>No return requests</h2><p>Requests submitted from sales invoices and purchase bills will appear here.</p></section>}</div>
 </>;
}
