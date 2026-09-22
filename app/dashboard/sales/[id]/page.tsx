import Link from "next/link";
import {notFound} from "next/navigation";
import {requirePermission} from "@/lib/access";
import {PrintButton} from "../print-button";
import {money} from "../types";
import "../sales.css";
const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;
export default async function SaleReceipt({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const {supabase:s}=await requirePermission("sales");
 const {data:r,error}=await s.from("sales_orders").select("*,centers(name,code),organizations(name),profiles(full_name),sales_order_lines(*),sales_payments(*)").eq("id",id).maybeSingle();
 if(error)throw new Error("Sale receipt could not be loaded");if(!r)notFound();
 const center=one(r.centers),org=one(r.organizations),user=one(r.profiles);
 return <><div className="page-heading"><Link href="/dashboard/sales">← Sales history</Link><PrintButton/><Link href="/dashboard/sales/new">New sale</Link></div><article className="sale-receipt"><header><h1>{org?.name??"CenterPro"}</h1><p>Powered by CenterPro</p><b>SALES RECEIPT</b></header><p>{r.sale_number}<br/>{new Date(r.confirmed_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"})}<br/>Center: {center?.code} · {center?.name}<br/>Customer: {r.customer_name}<br/>User: {user?.full_name}</p><table><thead><tr><th>Item</th><th>Qty / Price</th><th>Amount</th></tr></thead><tbody>{r.sales_order_lines.map((l:{id:string;product_name:string;quality_name:string;quantity:number;unit:string;unit_price:number;line_total:number})=><tr key={l.id}><td>{l.product_name}<br/>{l.quality_name}</td><td>{l.quantity} {l.unit}<br/>{money(Number(l.unit_price))}</td><td>{money(Number(l.line_total))}</td></tr>)}</tbody></table><dl><dt>Total</dt><dd><b>{money(Number(r.total_amount))}</b></dd><dt>Paid (excl. Credit)</dt><dd>{money(Number(r.paid_amount))}</dd><dt>Credit balance</dt><dd>{money(Number(r.credit_balance))}</dd><dt>Status</dt><dd>{r.payment_status.replaceAll("_"," ")}</dd></dl>{r.sales_payments.map((p:{id:string;method:string;amount:number;bank_name:string;account_number:string;branch_name:string;cheque_number:string;cheque_date:string})=><p key={p.id}>{p.method.replaceAll("_"," ")}: {money(Number(p.amount))}{p.bank_name&&<><br/>{p.bank_name} · {p.account_number} · {p.branch_name}</>}{p.cheque_number&&<><br/>Cheque {p.cheque_number} · {p.cheque_date}</>}</p>)}{r.notes&&<p>{r.notes}</p>}<p>Thank you</p></article></>;
}
