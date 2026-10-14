import { requirePermission } from "@/lib/access";
import { BankWorkspace } from "../bank-workspace";
import "../bank.css";

type Bank = { id:string;code:string;name:string };
type Account = {id:string;account_number:string;account_name:string|null;branch_name:string;branch_code:string;is_active:boolean;payment_banks:{code:string;name:string}|{code:string;name:string}[]|null};
export default async function BankAccountsPage(){
  const {supabase,profile}=await requirePermission("cash");
  if(profile.role!=="admin"&&profile.role!=="super_admin"){
    return <section className="panel" style={{padding:24}}>Bank management is restricted to administrators.</section>;
  }
  const [{data:banks,error:bankError},{data:accounts,error:accountError}]=await Promise.all([
    supabase.from("payment_banks").select("id,code,name").eq("organization_id",profile.organization_id).eq("is_active",true).order("name"),
    supabase.from("bank_accounts").select("id,account_number,account_name,branch_name,branch_code,is_active,payment_banks(code,name)").eq("organization_id",profile.organization_id).order("created_at")
  ]);
  if(bankError||accountError)throw new Error(bankError?.message??accountError?.message);
  const withBalances=await Promise.all(((accounts??[]) as Account[]).map(async account=>{
    const {data,error}=await supabase.rpc("bank_book_balance",{p_bank_account:account.id});
    if(error)throw new Error(`Bank management requires migration 043: ${error.message}`);
    return {...account,balance:Number(data??0)};
  }));
  return <BankWorkspace banks={(banks??[]) as Bank[]} initialAccounts={withBalances} organizationId={profile.organization_id}/>;
}
