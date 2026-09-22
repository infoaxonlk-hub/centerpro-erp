import Link from "next/link";
import {Bill} from "@/components/bill";
import {notFound} from "next/navigation";
import {requirePermission} from "@/lib/access";
import {PrintButton} from "../print-button";
import "../sales.css";
const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;
export default async function SaleReceipt({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const {supabase:s}=await requirePermission("sales");
 const {data:r,error}=await s.from("sales_orders").select("*,centers(name,code),organizations(name),profiles(full_name),sales_order_lines(*),sales_payments(*)").eq("id",id).maybeSingle();
 if(error)throw new Error("Sale receipt could not be loaded");if(!r)notFound();
 const center=one(r.centers),org=one(r.organizations),user=one(r.profiles);
 return <><nav className="bill-actions" aria-label="Receipt actions"><Link className="ghost" href="/dashboard/sales">← Sales history</Link><PrintButton/><Link className="primary" href="/dashboard/sales/new">+ New sale · POS</Link></nav><Bill data={{organization:org?.name??"CenterPro",title:"SALES RECEIPT",number:r.sale_number,date:new Date(r.confirmed_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"}),center:(center?.code??"")+" · "+(center?.name??""),party:r.customer_name,user:user?.full_name,total:Number(r.total_amount),paid:Number(r.paid_amount),credit:Number(r.credit_balance),status:r.payment_status,notes:r.notes,lines:r.sales_order_lines.map((l:{product_name:string;quality_name:string;quantity:number;unit:string;unit_price:number;line_total:number})=>({name:l.product_name,quality:l.quality_name,quantity:Number(l.quantity),unit:l.unit,price:Number(l.unit_price),total:Number(l.line_total)})),payments:r.sales_payments.map((p:{method:string;amount:number;bank_name:string;account_number:string;branch_name:string;cheque_number:string;cheque_date:string})=>({method:p.method,amount:Number(p.amount),details:[p.bank_name,p.account_number,p.branch_name,p.cheque_number?"Cheque "+p.cheque_number:null,p.cheque_date].filter(Boolean).join(" · ")}))}}/></>;
}
