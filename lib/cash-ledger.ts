import type {SupabaseClient} from "@supabase/supabase-js";
// Balances must include all cash movements, not only the latest 100 transactions.
export async function readCashLedger(client:SupabaseClient){
 const query=()=>client.from("cash_ledger").select("id,center_id,movement_type,amount,reference_type,note,created_at,centers(name,code),profiles(full_name)").order("created_at",{ascending:false}).order("id");
 const first=await query().range(0,499);
 if(first.error)throw new Error("Cash ledger could not be loaded: "+first.error.message);
 const data=first.data;
 if(data.length===500)for(let offset=500;;offset+=500){const page=await query().range(offset,offset+499);if(page.error)throw new Error("Cash ledger could not be loaded: "+page.error.message);data.push(...page.data);if(page.data.length<500)break;}
 return {data};
}
