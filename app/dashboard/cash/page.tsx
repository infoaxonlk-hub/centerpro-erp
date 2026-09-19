import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CashManager } from "./cash-manager";
import { BankAccountsManager } from "./bank-accounts-manager";
import { requirePermission } from "@/lib/access";

export default async function CashPage(){
 const {supabase,profile}=await requirePermission("cash");
 const {data:centers}=await supabase.from("centers").select("id,code,name").eq("is_active",true).order("name");
 const {data:ledger}=await supabase.from("cash_ledger").select("id,center_id,movement_type,amount,reference_type,note,created_at,centers(name,code),profiles(full_name)").order("created_at",{ascending:false}).limit(100);
 const [{data:banks},{data:accounts}]=await Promise.all([supabase.from("payment_banks").select("id,code,name").eq("is_active",true).order("name"),supabase.from("bank_accounts").select("id,account_number,account_name,branch_name,branch_code,is_active,payment_banks(code,name)").order("created_at")]);
 const canManage=profile?.role==="admin"||profile?.role==="super_admin";
 return <><CashManager initialLedger={ledger??[]} centers={centers??[]} canIssue={canManage}/><BankAccountsManager organizationId={profile.organization_id} banks={banks??[]} initialAccounts={accounts??[]} canManage={canManage}/></>;
}
