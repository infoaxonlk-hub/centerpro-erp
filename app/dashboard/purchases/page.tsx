import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function PurchasesPage(){
 const s=await createClient(); const {data:{user}}=await s.auth.getUser(); if(!user)redirect("/login");
 const {data:rows}=await s.from("purchase_orders").select("id,po_number,status,payment_method,total_amount,created_at,centers(name,code),suppliers(name)").order("created_at",{ascending:false});
 return <><div className="page-heading"><div><span className="eyebrow dark">PROCUREMENT</span><h1>Purchases</h1><p>Draft, confirmed and cancelled purchase orders.</p></div><Link className="primary" href="/dashboard/purchases/new">New purchase</Link></div><section className="panel table-panel"><table><thead><tr><th>PO</th><th>Center</th><th>Supplier</th><th>Date</th><th>Payment</th><th>Status</th><th className="number">Total</th></tr></thead><tbody>{(rows??[]).map(r=>{const c=Array.isArray(r.centers)?r.centers[0]:r.centers;const supplier=Array.isArray(r.suppliers)?r.suppliers[0]:r.suppliers;return <tr key={r.id}><td><strong>{r.po_number}</strong></td><td>{c?.code} · {c?.name}</td><td>{supplier?.name}</td><td>{new Date(r.created_at).toLocaleString("en-LK")}</td><td className="capitalize">{r.payment_method.replaceAll("_"," ")}</td><td><span className={`status ${r.status==="confirmed"?"active":"inactive"}`}>{r.status}</span></td><td className="number">{new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"}).format(Number(r.total_amount))}</td></tr>})}{!rows?.length&&<tr><td colSpan={7} className="table-empty">No purchase orders yet.</td></tr>}</tbody></table></section></>;
}
