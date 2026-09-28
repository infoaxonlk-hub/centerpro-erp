import Link from "next/link";
import {notFound} from "next/navigation";
import {BillDetail} from "@/components/bill-detail";
import {CancelBill} from "@/components/cancel-bill";
import {RequestBillReturn} from "@/components/request-bill-return";
import {requirePermission} from "@/lib/access";
import {PrintButton} from "../print-button";
import "../sales.css";

const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;

export default async function SaleReceipt({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const {supabase:s}=await requirePermission("sales");
 const {data:r,error}=await s.from("sales_orders").select("*,centers(name,code),organizations(name),profiles(full_name),sales_order_lines(*),sales_payments(*),sales_invoices(invoice_number,outstanding_amount,status)").eq("id",id).maybeSingle();
 if(error)throw new Error("Sale receipt could not be loaded");
 if(!r)notFound();
 const center=one(r.centers),org=one(r.organizations),user=one(r.profiles),invoice=one(r.sales_invoices);
 const {data:returns,error:returnError}=await s.from("bill_returns").select("status,bill_return_lines(source_line_id,quantity)").eq("bill_type","sale").eq("bill_id",id).in("status",["pending","approved"]);
 if(returnError)throw new Error(returnError.message);
 const returned=new Map<string,number>();
 for(const ret of returns??[])for(const line of ret.bill_return_lines??[])returned.set(line.source_line_id,(returned.get(line.source_line_id)??0)+Number(line.quantity));
 const returnLines=r.sales_order_lines.map((l:{id:string;product_name:string;quality_name:string;unit:string;quantity:number;unit_price:number})=>({id:l.id,name:l.product_name,quality:l.quality_name,unit:l.unit,quantity:Number(l.quantity),available:Math.max(0,Number(l.quantity)-(returned.get(l.id)??0)),unitPrice:Number(l.unit_price)}));
 return <>
  <nav className="bill-actions" aria-label="Receipt actions"><PrintButton/><CancelBill type="sale" id={id} disabled={r.status==="cancelled"}/>{r.status==="confirmed"&&<RequestBillReturn type="sale" billId={id} billNumber={invoice?.invoice_number??r.sale_number} lines={returnLines}/ >}<Link className="primary" href="/dashboard/sales/new">+ New sale · POS</Link></nav>
  {invoice&&<p className="panel" style={{padding:16}}>Invoice <strong>{invoice.invoice_number}</strong> · Due balance <strong>{new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"}).format(Number(invoice.outstanding_amount))}</strong> · {r.status==="cancelled"?"CANCELLED":invoice.status} {Number(invoice.outstanding_amount)>0&&<Link href="/dashboard/sales/receivables">Record payment</Link>}</p>}
  <BillDetail data={{organization:org?.name??"CenterPro",title:r.status==="cancelled"?"CANCELLED SALES INVOICE":"SALES INVOICE",number:invoice?.invoice_number??r.sale_number,date:new Date(r.confirmed_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"}),center:(center?.code??"")+" · "+(center?.name??""),party:r.customer_name,user:user?.full_name,total:Number(r.total_amount),paid:Number(r.paid_amount),credit:Number(r.credit_balance),status:r.status==="cancelled"?"cancelled":r.payment_status,notes:r.notes,lines:r.sales_order_lines.map((l:{product_name:string;quality_name:string;quantity:number;unit:string;unit_price:number;line_total:number})=>({name:l.product_name,quality:l.quality_name,quantity:Number(l.quantity),unit:l.unit,price:Number(l.unit_price),total:Number(l.line_total)})),payments:r.sales_payments.map((p:{method:string;amount:number;bank_name:string|null;account_number:string|null;branch_name:string|null;cheque_number:string|null;cheque_date:string|null})=>({method:p.method,amount:Number(p.amount),details:[p.bank_name,p.account_number,p.branch_name,p.cheque_number?"Cheque "+p.cheque_number:null,p.cheque_date].filter(Boolean).join(" · ")}))}}/>
 </>;
}
