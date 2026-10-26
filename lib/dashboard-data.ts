import {cache} from "react";
import {requirePermission} from "@/lib/access";
import {moduleEnabled} from "@/lib/business-modules";
import {readDashboardSummary} from "@/lib/dashboard-summary";
// React cache is request-scoped; it never shares tenant data between requests.
export const getDashboardSummary=cache(async()=>{
 const {supabase,profile,business}=await requirePermission("dashboard");
 const can=(module:string,permission:string)=>moduleEnabled(module,business.enabledModules)&&profile.permissions.includes(permission);
 return readDashboardSummary(supabase,{organizationId:profile.organization_id,purchases:can("purchases","purchases"),
  sales:can("sales","sales"),inventory:can("inventory","stock"),cash:can("cash","cash")});
});
