import {requirePermission} from "@/lib/access";
import {PaymentReports,type ReportRow} from "./payment-reports";

type Joined={name:string;code?:string}|{name:string;code?:string}[]|null;
const one=(value:Joined)=>Array.isArray(value)?value[0]:value;

export default async function PaymentReportsPage(){
 const {supabase:s,profile}=await requirePermission("payment_reports");
 const [{data:payments},{data:payables}]=await Promise.all([
  s.from("payments").select("id,amount,method,reference,cheque_number,cheque_date,bank_code,branch_code,created_at,centers(name,code),purchase_orders(po_number,payment_status,suppliers(name)),bank_accounts(account_number,account_name,branch_name,branch_code,payment_banks(name,code))").order("created_at",{ascending:false}),
  s.from("supplier_payables").select("id,original_amount,outstanding_amount,status,created_at,centers(name,code),suppliers(name),purchase_orders(po_number,payment_status)").order("created_at",{ascending:false})
 ]);
 const rows:ReportRow[]=[];
 for(const item of payments??[]){const center=one(item.centers);const po=Array.isArray(item.purchase_orders)?item.purchase_orders[0]:item.purchase_orders;const supplier=po?(Array.isArray(po.suppliers)?po.suppliers[0]:po.suppliers):null;const account=Array.isArray(item.bank_accounts)?item.bank_accounts[0]:item.bank_accounts;const bank=account?(Array.isArray(account.payment_banks)?account.payment_banks[0]:account.payment_banks):null;rows.push({id:`payment-${item.id}`,date:item.created_at,poNumber:po?.po_number??"—",center:`${center?.code??""} · ${center?.name??""}`,supplier:supplier?.name??"—",method:item.method,amount:Number(item.amount),reference:item.reference??"",status:"paid",bank:bank?.name??"",account:account?.account_number??"",branch:account?.branch_name??"",branchCode:account?.branch_code??item.branch_code??"",chequeNumber:item.cheque_number??"",chequeDate:item.cheque_date??""})}
 for(const item of payables??[]){const center=one(item.centers);const supplier=one(item.suppliers);const po=Array.isArray(item.purchase_orders)?item.purchase_orders[0]:item.purchase_orders;rows.push({id:`credit-${item.id}`,date:item.created_at,poNumber:po?.po_number??"—",center:`${center?.code??""} · ${center?.name??""}`,supplier:supplier?.name??"—",method:"credit",amount:Number(item.original_amount),reference:"",status:Number(item.outstanding_amount)>0?"outstanding":"paid",bank:"",account:"",branch:"",branchCode:"",chequeNumber:"",chequeDate:""})}
 return <PaymentReports rows={rows} isAdmin={["super_admin","admin"].includes(profile.role)}/>;
}
