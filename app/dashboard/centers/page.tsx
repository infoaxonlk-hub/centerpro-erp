import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CentersManager } from "./centers-manager";

export default async function CentersPage(){
  const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user)redirect("/login");
  const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();
  const {data:centers}=await supabase.from("centers").select("id,code,name,address,phone,allow_multiple_locations,is_active,locations(id,code,name,is_default,is_active)").order("name");
  return <CentersManager initialCenters={centers??[]} canManage={profile?.role==="admin"||profile?.role==="super_admin"}/>;
}
