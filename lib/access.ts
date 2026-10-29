import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireAuthenticatedProfile, readBusinessAccess, AccessError } from "@/lib/business-access";
import { moduleEnabled, moduleForPath } from "@/lib/business-modules";
export const allPermissions=["dashboard","sales","purchases","stock","manufacturing","cash","payment_reports","centers","users","masters","product_create","product_edit","stock_adjustment","labor","audit"] as const;
export type AppPermission=typeof allPermissions[number];
const permissionModule: Record<AppPermission,string> = {
 dashboard:"dashboard",sales:"sales",purchases:"purchases",stock:"inventory",manufacturing:"manufacturing",cash:"cash",
 payment_reports:"payment_reports",centers:"centers",users:"users",masters:"masters",
 product_create:"masters",product_edit:"masters",stock_adjustment:"stock_adjustments",labor:"labor",audit:"audit",
};
export async function requirePermission(permission: AppPermission | readonly AppPermission[], moduleOverride?: string) {
  let context;
  try { context = await requireAuthenticatedProfile(); }
  catch(error) {
    if(error instanceof AccessError && error.status===401) redirect("/login");
    redirect("/login?error=Your account is inactive");
  }
  const { supabase, user, profile } = context;
  const permissions: string[] = profile.role==="super_admin" ? [...allPermissions] : [...(profile.permissions ?? [])];
  const path = (await headers()).get("x-centerpro-path") ?? "";
  const business = await readBusinessAccess(supabase);
  if (!business.operational) redirect("/dashboard/account");
  const key = moduleForPath(path);
  const required = Array.isArray(permission) ? permission : [permission];
  if (business.enabledModules.includes("manufacturing") && permissions.includes("stock") && !permissions.includes("manufacturing")) permissions.push("manufacturing");
  if (!required.some(p => permissions.includes(p))) redirect("/dashboard?error=Access denied");
  const moduleKey = moduleOverride ?? ((key && key !== "dashboard") ? key : permissionModule[required[0] as AppPermission]);
  if (moduleKey && !moduleEnabled(moduleKey,business.enabledModules)) redirect("/dashboard/restricted?module="+moduleKey);
  return {supabase,user,profile:{...profile,permissions},business};
}
