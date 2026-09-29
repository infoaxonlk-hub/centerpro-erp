import { requirePermission } from "@/lib/access";
import { ExpenseManager } from "./expense-manager";
import "@/app/expenses.css";

export default async function ExpensesPage(){
 const {supabase,profile}=await requirePermission("cash");
 const isAdmin=profile.role==="admin"||profile.role==="super_admin";
 async function loadExpenses(){
  const rows:unknown[]=[];
  for(let offset=0;;offset+=500){const {data,error}=await supabase.from("expenses").select("id,expense_date,payee,amount,method,payment_status,reference,cheque_number,cheque_date,bank_code,branch_code,notes,created_at,centers(code,name),expense_categories(code,name),bank_accounts(account_number,account_name,branch_name,payment_banks(code,name))").order("expense_date",{ascending:false}).order("created_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+499);if(error)throw new Error(error.message);rows.push(...data);if(data.length<500)break}
  return {data:rows};
 }
 const [{data:centers},{data:categories},{data:accounts},{data:expenses},{data:handovers},{data:ledger}]=await Promise.all([
  supabase.from("centers").select("id,code,name").eq("is_active",true).order("name"),
  supabase.from("expense_categories").select("id,code,name,description,is_active").order("name"),
  supabase.from("bank_accounts").select("id,account_number,account_name,branch_name,branch_code,is_active,payment_banks(code,name)").eq("is_active",true).order("account_number"),
  loadExpenses(),
  supabase.from("expense_cash_handovers").select("id,center_id,issued_amount,received_amount,difference_amount,reference,issue_note,response_note,status,issued_at,responded_at,centers(code,name)").order("issued_at",{ascending:false}).limit(100),
  supabase.from("expense_cash_ledger").select("id,center_id,movement_type,amount,created_at").order("created_at",{ascending:false}).limit(500)
 ]);
 return <ExpenseManager organizationId={profile.organization_id} centers={centers??[]} categories={categories??[]} accounts={accounts??[]} initialExpenses={expenses??[]} handovers={handovers??[]} ledger={ledger??[]} isAdmin={isAdmin}/>;
}
