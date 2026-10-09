import {readCashLedger} from "@/lib/cash-ledger";
import { CashManager } from "./cash-manager";
import { BankAccountsManager } from "./bank-accounts-manager";
import {CashTopups} from "./topups";
import { requirePermission } from "@/lib/access";

export default async function CashPage(){
 const {supabase,profile}=await requirePermission("cash");
 const {data:centers}=await supabase.from("centers").select("id,code,name").eq("is_active",true).order("name");
 const initialBalances=await Promise.all((centers??[]).map(async center=>{
  const {data,error}=await supabase.rpc("center_cash_balance",{target_center:center.id});
  return {center_id:center.id,balance:error||data===null?null:Number(data)};
 }));
 const {data:ledger}=await readCashLedger(supabase);
 const {data:handovers}=await supabase.from("cash_handovers").select("id,center_id,issued_amount,received_amount,difference_amount,reference,issue_note,response_note,status,issued_at,responded_at,centers(name,code),issuer:profiles!cash_handovers_issued_by_fkey(full_name),receiver:profiles!cash_handovers_received_by_fkey(full_name)").order("issued_at",{ascending:false}).limit(100);
 const [{data:banks},{data:accounts}]=await Promise.all([supabase.from("payment_banks").select("id,code,name").eq("is_active",true).order("name"),supabase.from("bank_accounts").select("id,account_number,account_name,branch_name,branch_code,is_active,payment_banks(code,name)").order("created_at")]);
 const canManage=profile?.role==="admin"||profile?.role==="super_admin";
 const {data:topups}=await supabase.from("center_cash_topups").select("id,center_id,amount,reference,notes,status,created_at").order("created_at",{ascending:false}).limit(200);
 return <><CashManager initialLedger={ledger??[]} initialHandovers={handovers??[]} centers={centers??[]} initialBalances={initialBalances} canIssue={canManage}/><CashTopups centers={centers??[]} rows={topups??[]} isAdmin={canManage}/><BankAccountsManager organizationId={profile.organization_id} banks={banks??[]} initialAccounts={accounts??[]} canManage={canManage}/></>;
}
