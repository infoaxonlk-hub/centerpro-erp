import {requirePermission} from "@/lib/access";
import {CreditLedger,type CreditRow} from "@/components/credit-ledger";
import {creditBanks} from "@/lib/credit-data";
const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;
export async function CreditPayablesPage(){const {supabase:s}=await requirePermission(["purchases","payment_reports"]);const {data,error}=await s.from("supplier_payables").select("id,purchase_order_id,original_amount,outstanding_amount,status,created_at,centers(code,name),suppliers(name,phone),purchase_orders(po_number)").neq("status","void").order("created_at",{ascending:false});if(error)throw new Error(error.message);
 const rows:CreditRow[]=(data??[]).map(x=>{const c=one(x.centers),p=one(x.suppliers),o=one(x.purchase_orders);return{id:x.id,billId:x.purchase_order_id,number:o?.po_number??"—",date:x.created_at,center:`${c?.code??""} · ${c?.name??""}`,party:p?.name??"—",phone:p?.phone??"",total:Number(x.original_amount),original:Number(x.original_amount),outstanding:Number(x.outstanding_amount),status:x.status}});
 return <CreditLedger type="payable" rows={rows} banks={await creditBanks(s)}/>}
