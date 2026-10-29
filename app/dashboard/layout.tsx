import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { allPermissions } from "@/lib/access";
import { requireAuthenticatedProfile, readBusinessAccess } from "@/lib/business-access";
import { moduleEnabled, moduleForPath } from "@/lib/business-modules";
import { BusinessAccessMonitor } from "@/components/business-access-monitor";
import { FeedbackHost } from "@/components/feedback";
import "@/app/module-access.css";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let context;
  try { context = await requireAuthenticatedProfile(); } catch { redirect("/login?error=Your account is inactive or unavailable"); }
  const { supabase, profile } = context;
  const business = await readBusinessAccess(supabase);
  const path = (await headers()).get("x-centerpro-path") ?? "/dashboard";
  const platformPath = /^\/dashboard\/businesses(\/|$)/.test(path) && profile.role==="super_admin";
  const safePath = /^\/dashboard\/(account|restricted)(\/|$)/.test(path);
  if (!platformPath && !safePath) {
    if (!business.operational) redirect("/dashboard/account");
    const key = moduleForPath(path);
    if (key && !moduleEnabled(key,business.enabledModules)) redirect("/dashboard/restricted?module="+key);
  }
  const permissions = profile.role==="super_admin" ? [...allPermissions] : [...(profile.permissions ?? [])];
  if (business.enabledModules.includes("manufacturing") && permissions.includes("stock") && !permissions.includes("manufacturing")) permissions.push("manufacturing");
  const isAdmin = ["super_admin","admin"].includes(profile.role);
  const {data:organization}=await supabase.from("organizations").select("name").eq("id",profile.organization_id).single();
  const {data:assignments}=business.operational ? await supabase.from("user_center_access")
    .select("centers(code,name)").eq("user_id",profile.id) : {data:[]};
  const assignedCenters=(assignments??[]).map(access=>{const center=Array.isArray(access.centers)?access.centers[0]:access.centers;return center ? center.code+" · "+center.name : "";}).filter(Boolean);
  const {data:notifications}=business.operational && !platformPath ? await supabase.from("notifications")
    .select("id,type,title,message,is_read,created_at,centers(name,code)").order("created_at",{ascending:false}).limit(30) : {data:[]};
  const notices=(notifications??[]).map(n=>{const center=Array.isArray(n.centers)?n.centers[0]:n.centers;
    return {id:n.id,type:n.type,title:n.title,message:n.message,isRead:n.is_read,createdAt:n.created_at,center:center?center.code+" · "+center.name:""};});
  return <><BusinessAccessMonitor initial={business} isSuperAdmin={profile.role === "super_admin"}/><AppShell companyName={organization?.name??""} name={profile.full_name} role={profile.role}
    permissions={permissions} enabledModules={business.enabledModules} notifications={notices}
    isAdmin={isAdmin} assignedCenters={assignedCenters}>{children}</AppShell><FeedbackHost/></>;
}
