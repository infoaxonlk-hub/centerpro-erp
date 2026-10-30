import {requirePermission} from "@/lib/access";
import {CreditLedger,type CreditRow} from "@/components/credit-ledger";
import {creditBanks} from "@/lib/credit-data";
const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;
export default async function ReceivablesPage(){const {supabase:s}=await requirePermission("sales");const [{data,error},{data:credits,error:creditError}]=await Promise.all([s.from("sales_invoices").select("id,sales_order_id,invoice_number,total_amount,outstanding_amount,status,created_at,centers(code,name),customers(name,phone),sales_orders(customer_name,order_source)").neq("status","cancelled").order("created_at",{ascending:false}),s.from("customer_receivables").select("sales_order_id,original_amount").eq("is_void",false)]);if(error||creditError)throw new Error(error?.message??creditError?.message);
 const originalBySale=new Map((credits??[]).map(x=>[x.sales_order_id,Number(x.original_amount)]));
 const rows:CreditRow[]=(data??[]).filter(x=>originalBySale.has(x.sales_order_id)).map(x=>{const c=one(x.centers),p=one(x.customers),o=one(x.sales_orders);return{id:x.id,orderSource:o?.order_source??"stock",billId:x.sales_order_id,number:x.invoice_number,date:x.created_at,center:`${c?.code??""} · ${c?.name??""}`,party:p?.name??o?.customer_name??"—",phone:p?.phone??"",total:Number(x.total_amount),original:originalBySale.get(x.sales_order_id)??0,outstanding:Number(x.outstanding_amount),status:x.status}});
 return <CreditLedger type="receivable" rows={rows} banks={await creditBanks(s)}/>}
