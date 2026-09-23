import type {SupabaseClient} from "@supabase/supabase-js";
import type {CreditBank} from "@/components/credit-ledger";
export async function creditBanks(s:SupabaseClient):Promise<CreditBank[]>{const {data,error}=await s.from("bank_accounts").select("id,account_number,account_name,branch_name,payment_banks(name)").eq("is_active",true);if(error)throw new Error(error.message);return (data??[]).map(x=>{const b=Array.isArray(x.payment_banks)?x.payment_banks[0]:x.payment_banks;return {id:x.id,label:`${b?.name??"Bank"} · ${x.account_number} · ${x.branch_name}`}})}
