import {readCashLedger} from "@/lib/cash-ledger";

import { BankAccountsManager } from "./bank-accounts-manager";
import {CashTopups} from "./topups";
import {UnifiedCash} from "./unified-cash";
import { requirePermission } from "@/lib/access";

export default async function CashPage(){
 const {supabase,profile}=await requirePermission("cash");
 const {data:centers}=await supabase.from("centers").select("id,code,name").eq("is_active",true).order("name");
 const {data:ledger}=await readCashLedger(supabase);
 const {data:handovers}=await supabase.from("cash_handovers").select("id,center_id,issued_amount,received_amount,difference_amount,reference,issue_note,response_note,status,issued_at,responded_at,centers(name,code),issuer:profiles!cash_handovers_issued_by_fkey(full_name),receiver:profiles!cash_handovers_received_by_fkey(full_name)").order("issued_at",{ascending:false}).limit(100);
 const [{data:banks},{data:accounts}]=await Promise.all([supabase.from("payment_banks").select("id,code,name").eq("is_active",true).order("name"),supabase.from("bank_accounts").select("id,account_number,account_name,branch_name,branch_code,is_active,payment_banks(code,name)").order("created_at")]);
 const canManage=profile?.role==="admin"||profile?.role==="super_admin";
 const {data:topups}=await supabase.from("center_cash_topups").select("id,center_id,amount,reference,notes,status,created_at").order("created_at",{ascending:false}).limit(200);
 const [{data:issues},{data:cashIns},floatResult]=await Promise.all([
  supabase.from("center_cash_issues").select("id,center_id,reference,purchase_issued,expense_issued,purchase_received,expense_received,status,issued_at,received_at,centers(id,code,name)").order("issued_at",{ascending:false}).limit(200),
  canManage?supabase.from("admin_cash_in").select("id,amount,source,source_details,created_at").order("created_at",{ascending:false}).limit(100):Promise.resolve({data:[]}),
  canManage?supabase.rpc("cash_float_available"):Promise.resolve({data:0})
 ]);
 const expenseBalances=await Promise.all((centers??[]).map(c=>supabase.rpc("center_expense_cash_balance",{target_center:c.id})));
 const expenseAvailable=expenseBalances.reduce((sum,result)=>sum+Number(result.data??0),0);
 const purchaseAvailable=(ledger??[]).reduce((sum,row)=>sum+(["allocation","refund","sale_receipt"].includes(row.movement_type)?Number(row.amount):-Number(row.amount)),0);
 return <><div className="page-heading"><div><span className="eyebrow dark">FUNDS CONTROL</span><h1>Cash & Payments</h1><p>Admin cash float, combined center handovers and center receipts.</p></div></div><UnifiedCash isAdmin={canManage} centers={centers??[]} issues={issues??[]} cashIns={cashIns??[]} available={Number(floatResult.data??0)} purchaseAvailable={purchaseAvailable} expenseAvailable={expenseAvailable}/><CashTopups centers={centers??[]} rows={topups??[]} isAdmin={canManage}/><BankAccountsManager organizationId={profile.organization_id} banks={banks??[]} initialAccounts={accounts??[]} canManage={canManage}/></>;
}


