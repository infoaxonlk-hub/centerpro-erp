import {requirePermission} from "@/lib/access";
import {ChequeManager,type ChequeRow} from "../cheque-manager";
const one=<T,>(v:T|T[]|null)=>Array.isArray(v)?v[0]:v;
export default async function ChequesPage(){
  const{supabase:s,profile}=await requirePermission("payment_reports");
  const[{data:payments},{data:organization}]=await Promise.all([
    s.from("payments").select("id,amount,reference,cheque_number,cheque_date,cheque_status,cheque_notes,created_at,centers(name,code),purchase_orders(po_number,suppliers(name)),bank_accounts(account_number,branch_name,branch_code,payment_banks(name))").eq("method","cheque").order("cheque_date",{ascending:true}),
    s.from("organizations").select("cheque_reminder_days").eq("id",profile.organization_id).single()
  ]);
  const rows:ChequeRow[]=(payments??[]).map(x=>{const c=one(x.centers),po=one(x.purchase_orders),supplier=po?one(po.suppliers):null,account=one(x.bank_accounts),bank=account?one(account.payment_banks):null;return{id:x.id,enteredAt:x.created_at,chequeDate:x.cheque_date??"",chequeNumber:x.cheque_number??"—",po:po?.po_number??"—",center:`${c?.code??""} · ${c?.name??""}`,supplier:supplier?.name??"—",bank:bank?.name??"—",account:account?.account_number??"—",branch:account?.branch_name??account?.branch_code??"—",amount:Number(x.amount),status:x.cheque_status??"pending",notes:x.cheque_notes??""}});
  return <ChequeManager initialRows={rows} reminderDays={organization?.cheque_reminder_days??3} isAdmin={["super_admin","admin"].includes(profile.role)}/>;
}
