import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CashManager } from "./cash-manager";
import { requirePermission } from "@/lib/access";

export default async function CashPage(){
 const {supabase,profile}=await requirePermission("cash");
 const {data:centers}=await supabase.from("centers").select("id,code,name").eq("is_active",true).order("name");
 const {data:ledger}=await supabase.from("cash_ledger").select("id,center_id,movement_type,amount,reference_type,note,created_at,centers(name,code),profiles(full_name)").order("created_at",{ascending:false}).limit(100);
 return <CashManager initialLedger={ledger??[]} centers={centers??[]} canIssue={profile?.role==="admin"||profile?.role==="super_admin"}/>;
}
