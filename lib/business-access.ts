import { createClient } from "@/lib/supabase/server";
import type { BusinessAccess } from "@/lib/business-modules";
import { moduleEnabled } from "@/lib/business-modules";
import {sessionFailureStatus} from "@/lib/auth-status";

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function requireAuthenticatedProfile() {
  const supabase = await createClient();
  const { data: { user },error:authError } = await supabase.auth.getUser();
  if (!user){const status=sessionFailureStatus(authError);throw new AccessError(status,status===401?"Please sign in.":"Session verification is temporarily unavailable. Please retry.");}
  const { data: profile, error } = await supabase.from("profiles")
    .select("id,organization_id,full_name,role,is_active,permissions").eq("id", user.id).maybeSingle();
  if(error)throw new AccessError(503,"Your profile could not be verified. Please retry.");
  if (!profile?.is_active) throw new AccessError(403, "Your account is inactive or unavailable.");
  return { supabase, user, profile };
}
export async function requireSuperAdmin() {
  const context = await requireAuthenticatedProfile();
  if (context.profile.role !== "super_admin") throw new AccessError(403, "Platform administrator access required.");
  return context;
}
export async function readBusinessAccess(supabase: Awaited<ReturnType<typeof createClient>>): Promise<BusinessAccess> {
  const { data, error } = await supabase.rpc("current_business_access");
  if (error || !data || typeof data.operational!=="boolean" || !Array.isArray(data.enabledModules)) throw new AccessError(503, "Business access could not be verified. Please retry or contact InfoAxon Support.");
  return data as BusinessAccess;
}
export async function requireBusinessApi(moduleKey: string) {
  const context = await requireAuthenticatedProfile();
  const business = await readBusinessAccess(context.supabase);
  if (!business.operational) throw new AccessError(403, business.reason === "suspended"
    ? "Your business account is temporarily suspended. Please contact InfoAxon Support for assistance."
    : "Your subscription does not currently permit business operations. Please contact InfoAxon Support.");
  if (!moduleEnabled(moduleKey, business.enabledModules)) throw new AccessError(403, "Module Access Restricted");
  return { ...context, business };
}
