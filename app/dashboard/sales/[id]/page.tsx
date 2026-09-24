import Link from "next/link";
import {BillDetail} from "@/components/bill-detail";
import {notFound} from "next/navigation";
import {requirePermission} from "@/lib/access";
import {PrintButton} from "../print-button";
import {CancelBill} from "@/components/cancel-bill";
import "../sales.css";
const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;
export default async function SaleReceipt({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const {supabase:s}=await requirePermission("sales");
 const {data:r,error}=await s.from("sales_orders").select("*,centers(name,code),organizations(name),profiles(full_name),sales_order_lines(*),sales_payments(*),sales_invoices(invoice_number,outstanding_amount,status)").eq("id",id).maybeSingle();
 if(error)throw new Error("Sale receipt could not be loaded");if(!r)notFound();
 const center=one(r.centers),org=one(r.organizations),user=one(r.profiles);
 const invoice=one(r.sales_invoices);
 return <><nav className="bill-actions" aria-label="Receipt actions"><PrintButton/><CancelBill type="sale" id={id} disabled={r.status==="cancelled"}/><Link className="primary" href="/dashboard/sales/new">+ New sale · POS</Link></nav>{invoice&&<p className="panel" style={{padding:16}}>Invoice <strong>{invoice.invoice_number}</strong> · Due balance <strong>{new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"}).format(Number(invoice.outstanding_amount))}</strong> · {r.status==="cancelled"?"CANCELLED":invoice.status} {Number(invoice.outstanding_amount)>0&&<Link href="/dashboard/sales/receivables">Record payment</Link>}</p>}<BillDetail data={{organization:org?.name??"CenterPro",title:r.status==="cancelled"?"CANCELLED SALES INVOICE":"SALES INVOICE",number:invoice?.invoice_number??r.sale_number,date:new Date(r.confirmed_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"}),center:(center?.code??"")+" · "+(center?.name??""),party:r.customer_name,user:user?.full_name,total:Number(r.total_amount),paid:Number(r.paid_amount),credit:Number(r.credit_balance),status:r.status==="cancelled"?"cancelled":r.payment_status,notes:r.notes,lines:r.sales_order_lines.map((l:{product_name:string;quality_name:string;quantity:number;unit:string;unit_price:number;line_total:number})=>({name:l.product_name,quality:l.quality_name,quantity:Number(l.quantity),unit:l.unit,price:Number(l.unit_price),total:Number(l.line_total)})),payments:r.sales_payments.map((p:{method:string;amount:number;bank_name:string;account_number:string;branch_name:string;cheque_number:string;cheque_date:string})=>({method:p.method,amount:Number(p.amount),details:[p.bank_name,p.account_number,p.branch_name,p.cheque_number?"Cheque "+p.cheque_number:null,p.cheque_date].filter(Boolean).join(" · ")}))}}/></>;
}
