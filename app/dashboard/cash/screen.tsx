import {readCashLedger} from "@/lib/cash-ledger";
import {CashManager} from "./cash-manager";
import {UnifiedCash} from "./unified-cash";
import {BankAccountsManager} from "./bank-accounts-manager";
import {CashTopups} from "./topups";
import {requirePermission} from "@/lib/access";

export async function CashScreen({view}:{view:"available"|"handovers"|"ledger"|"top-ups"|"bank-accounts"}){
 const {supabase,profile}=await requirePermission("cash");
 const isAdmin=profile.role==="admin"||profile.role==="super_admin";
 const {data:centers,error:centerError}=await supabase.from("centers").select("id,code,name").eq("is_active",true).order("name");
 if(centerError)throw new Error(centerError.message);
 const availableCenters=centers??[];
 if(view==="available"||view==="ledger"){
  const [{data:accounts,error:accountsError},{data:issues,error:issueError},{data:cashIns,error:cashInError},{data:entries,error:entryError}]=await Promise.all([
   supabase.from("cash_accounts").select("id,kind,center_id,name").order("kind").order("name"),
   supabase.from("center_cash_issues").select("id,center_id,reference,purchase_issued,expense_issued,purchase_received,expense_received,status,receipt_note,issued_at,received_at,centers(id,code,name)").order("issued_at",{ascending:false}).limit(200),
   isAdmin?supabase.from("admin_cash_in").select("id,amount,source,source_details,created_at").order("created_at",{ascending:false}).limit(200):Promise.resolve({data:[],error:null}),
   supabase.from("cash_account_entries").select("id,debit_account_id,credit_account_id,amount,source_table,posting_key,note,created_at").order("created_at",{ascending:false}).limit(100)
  ]);
  const failure=accountsError??issueError??cashInError??entryError;
  if(failure)throw new Error(`Cash accounts are not ready: ${failure.message}. Run migration 039 before deploying this application.`);
  const loaded=await Promise.all((accounts??[]).map(async a=>{
   const {data,error}=await supabase.rpc("cash_account_balance",{p_account:a.id});
   return {...a,balance:error?null:Number(data)};
  }));
  return <UnifiedCash isAdmin={isAdmin} centers={availableCenters} accounts={loaded} issues={issues??[]} cashIns={cashIns??[]} entries={entries??[]}/>;
 }
 if(view==="handovers"){
  const {data:handovers,error}=await supabase.from("cash_handovers").select("id,center_id,issued_amount,received_amount,difference_amount,reference,issue_note,response_note,status,issued_at,responded_at,centers(name,code),issuer:profiles!cash_handovers_issued_by_fkey(full_name),receiver:profiles!cash_handovers_received_by_fkey(full_name)").order("issued_at",{ascending:false}).limit(100);
  if(error)throw new Error(error.message);
  const initialBalances=await Promise.all(availableCenters.map(async center=>{
   const {data,error}=await supabase.rpc("center_cash_balance",{target_center:center.id});
   return {center_id:center.id,balance:error?null:Number(data)};
  }));
  const {data:ledger}=await readCashLedger(supabase);
  // Historical handovers are receivable, but issuing new money uses Admin Main only.
  return <CashManager view="handovers" initialLedger={ledger??[]} initialHandovers={handovers??[]} centers={availableCenters} initialBalances={initialBalances} canIssue={false}/>;
 }
 if(view==="top-ups"){
  const {data:topups,error}=await supabase.from("center_cash_topups").select("id,center_id,amount,reference,notes,status,created_at").order("created_at",{ascending:false}).limit(200);
  if(error)throw new Error(error.message);
  return <CashTopups centers={availableCenters} rows={topups??[]} isAdmin={isAdmin}/>;
 }
 const [{data:banks},{data:accounts}]=await Promise.all([
  supabase.from("payment_banks").select("id,code,name").eq("is_active",true).order("name"),
  supabase.from("bank_accounts").select("id,account_number,account_name,branch_name,branch_code,is_active,payment_banks(code,name)").order("created_at")
 ]);
 return <BankAccountsManager organizationId={profile.organization_id} banks={banks??[]} initialAccounts={accounts??[]} canManage={isAdmin}/>;
}
