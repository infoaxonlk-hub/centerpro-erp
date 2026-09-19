import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CentersManager } from "./centers-manager";
import { requirePermission } from "@/lib/access";

export default async function CentersPage(){
  const {supabase,profile}=await requirePermission("centers");
  const {data:centers}=await supabase.from("centers").select("id,code,name,address,phone,allow_multiple_locations,is_active,locations(id,code,name,is_default,is_active)").order("name");
  return <CentersManager initialCenters={centers??[]} canManage={profile?.role==="admin"||profile?.role==="super_admin"}/>;
}
