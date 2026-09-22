import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
export const allPermissions=["dashboard","sales","purchases","stock","cash","payment_reports","centers","users","masters","audit"] as const;
export type AppPermission=typeof allPermissions[number];
export async function requirePermission(permission:AppPermission){const supabase=await createClient();const{data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login");const{data:profile}=await supabase.from("profiles").select("id,organization_id,full_name,role,is_active,permissions").eq("id",user.id).single();if(!profile?.is_active)redirect("/login?error=Your account is inactive");const permissions=profile.role==="super_admin"?[...allPermissions]:(profile.permissions??[]);if(!permissions.includes(permission))redirect("/dashboard?error=Access denied");return{supabase,user,profile:{...profile,permissions}};}
