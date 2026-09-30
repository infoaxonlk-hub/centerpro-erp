import Link from "next/link";
import {notFound} from "next/navigation";
import {BillDetail} from "@/components/bill-detail";
import {CancelBill} from "@/components/cancel-bill";
import {RequestBillReturn} from "@/components/request-bill-return";
import {requirePermission} from "@/lib/access";
import {PrintButton} from "@/app/dashboard/sales/print-button";
import "@/app/dashboard/sales/sales.css";

const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;

export default async function PurchaseBill({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const {supabase:s}=await requirePermission("purchases");
 const {data:r,error}=await s.from("purchase_orders").select("id,po_number,center_id,status,total_amount,paid_amount,credit_balance,payment_status,notes,confirmed_at,centers(name,code),organizations(name,receipt_address,receipt_phone,receipt_email),suppliers(name),purchase_order_lines(id,product_id,quality_id,location_id,quantity,actual_price,line_total,products(name,unit_of_measure),product_qualities(name)),payments(method,amount,reference)").eq("id",id).maybeSingle();
 if(error)throw new Error(error.message);
 if(!r)notFound();
 const c=one(r.centers),o=one(r.organizations),p=one(r.suppliers);
 const {data:returns,error:returnError}=await s.from("bill_returns").select("status,bill_return_lines(source_line_id,quantity)").eq("bill_type","purchase").eq("bill_id",id).in("status",["pending","approved"]);
 if(returnError)throw new Error(returnError.message);
 const returned=new Map<string,number>();
 for(const ret of returns??[])for(const line of ret.bill_return_lines??[])returned.set(line.source_line_id,(returned.get(line.source_line_id)??0)+Number(line.quantity));
 const returnLines=r.purchase_order_lines.map(l=>{const product=one(l.products),quality=one(l.product_qualities);return{id:l.id,name:product?.name??"—",quality:quality?.name??"",unit:product?.unit_of_measure??"",quantity:Number(l.quantity),available:Math.max(0,Number(l.quantity)-(returned.get(l.id)??0)),unitPrice:Number(l.actual_price)}});
 return <>
  <nav className="bill-actions"><PrintButton/><CancelBill type="purchase" id={id} disabled={r.status==="cancelled"}/>{r.status==="confirmed"&&<RequestBillReturn type="purchase" billId={id} billNumber={r.po_number} lines={returnLines}/ >}{Number(r.credit_balance)>0&&<Link className="primary" href="/dashboard/payment-reports/payables">Pay credit</Link>}</nav>
  <BillDetail data={{organization:o?.name??"CenterPro",companyDetails:[o?.receipt_address,o?.receipt_phone,o?.receipt_email].filter((value):value is string=>!!value),title:r.status==="cancelled"?"CANCELLED PURCHASE BILL":"PURCHASE BILL",number:r.po_number,date:new Date(r.confirmed_at??"").toLocaleString("en-LK",{timeZone:"Asia/Colombo"}),center:`${c?.code??""} · ${c?.name??""}`,party:p?.name??"Cash purchase",total:Number(r.total_amount),paid:Number(r.paid_amount),credit:Number(r.credit_balance),status:r.status==="cancelled"?"cancelled":r.payment_status,notes:r.notes??undefined,lines:r.purchase_order_lines.map(l=>{const product=one(l.products),quality=one(l.product_qualities);return{name:product?.name??"—",quality:quality?.name,quantity:Number(l.quantity),unit:product?.unit_of_measure??"",price:Number(l.actual_price),total:Number(l.line_total)}}),payments:r.payments.map(x=>({method:x.method,amount:Number(x.amount),details:x.reference??undefined}))}}/>
 </>;
}
