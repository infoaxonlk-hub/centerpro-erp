import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { allPermissions } from "@/lib/access";
import { FeedbackHost } from "@/components/feedback";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name,role,is_active,permissions").eq("id", user.id).single();
  if (!profile?.is_active) redirect("/login?error=Your account is inactive");
  const permissions=profile.role==="super_admin"?[...allPermissions]:(profile.permissions??[]);
  const isAdmin=["super_admin","admin"].includes(profile.role);
  const {data:notifications}=isAdmin?await supabase.from("notifications").select("id,type,title,message,is_read,created_at,centers(name,code)").order("created_at",{ascending:false}).limit(30):{data:[]};
  const notices=(notifications??[]).map(n=>{const center=Array.isArray(n.centers)?n.centers[0]:n.centers;return{id:n.id,type:n.type,title:n.title,message:n.message,isRead:n.is_read,createdAt:n.created_at,center:center?`${center.code} · ${center.name}`:""}});
  return <><AppShell name={profile.full_name} role={profile.role} permissions={permissions} notifications={notices} isAdmin={isAdmin}>{children}</AppShell><FeedbackHost/></>;
}
