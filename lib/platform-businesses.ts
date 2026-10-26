import { z } from "zod";
import type { BusinessRecord } from "@/lib/business-types";
import { AccessError } from "@/lib/business-access";
import { businessModules, moduleKeys, normalizeModules } from "@/lib/business-modules";
import { createAdminClient } from "@/lib/supabase/admin";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "Enter a valid date");
export const subscriptionSchema = z.object({
  plan: z.enum(["Starter", "Professional", "Enterprise", "Custom"]),
  status: z.enum(["trialing", "active", "past_due", "expired", "cancelled"]),
  starts_on: date, expires_on: date.nullable(), trial_ends_on: date.nullable(),
  admin_notes: z.string().max(4000).default(""),
}).superRefine((value, context) => {
  if (value.expires_on && value.expires_on < value.starts_on) context.addIssue({ code: "custom", message: "Expiration must follow the start date.", path: ["expires_on"] });
  if (value.trial_ends_on && value.trial_ends_on < value.starts_on) context.addIssue({ code: "custom", message: "Trial end must follow the start date.", path: ["trial_ends_on"] });
  if (value.status === "trialing" && !value.trial_ends_on) context.addIssue({ code: "custom", message: "Trial end date is required.", path: ["trial_ends_on"] });
});
export const businessDetailsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  status: z.enum(["active", "suspended"]).default("active"),
  address: z.string().trim().max(500).default(""),
  phone: z.string().trim().max(50).default(""),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
});
export const businessConfigurationSchema = z.object({
  details: businessDetailsSchema,
  subscription: subscriptionSchema,
  modules: z.array(z.enum(moduleKeys as [string, ...string[]])).max(moduleKeys.length).transform(normalizeModules),
});
const modernCreateBusinessSchema = businessConfigurationSchema.extend({
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().email(),
  password: z.string().min(8).max(72),
});
// Keep the original provisioning payload supported for existing callers.
// Without an explicit selection it receives mandatory core only.
export const createBusinessSchema = z.preprocess(value => {
  if(!value||typeof value!=="object"||"details" in value)return value;
  const legacy=value as Record<string,unknown>;
  if(!("name" in legacy))return value;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  return {
    details:{name:legacy.name,status:"active",address:"",phone:"",email:""},
    adminName:legacy.adminName,adminEmail:legacy.email,password:legacy.password,
    modules:legacy.modules??["dashboard"],
    subscription:legacy.subscription??{plan:"Custom",status:"active",starts_on:today,expires_on:null,trial_ends_on:null,admin_notes:""},
  };
},modernCreateBusinessSchema);
export type BusinessConfiguration = z.infer<typeof businessConfigurationSchema>;
export function platformFailure(error: unknown): Response {
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  if(error instanceof SyntaxError)return Response.json({error:"Invalid JSON request."},{status:400});
  if (error instanceof z.ZodError) return Response.json({ error: error.issues.map(i => i.message).join(" ") }, { status: 400 });
  console.error("Platform business request failed", error instanceof Error ? error.message : "Database request failed");
  return Response.json({ error: "The business request could not be completed. Please try again or contact InfoAxon Support." }, { status: 500 });
}
export function provisionPermissions(modules: readonly string[]) {
  const permissions = new Set<string>(["dashboard"]);
  for (const item of businessModules) if (modules.includes(item.key)) for (const p of item.permissions) permissions.add(p);
  if (permissions.has("masters")) { permissions.add("product_create"); permissions.add("product_edit"); }
  return [...permissions];
}
export const businessSelect = "id,name,business_status,receipt_address,receipt_phone,receipt_email,created_at,updated_at,profiles(id,full_name,email,role,is_active),business_subscriptions(organization_id,plan,status,starts_on,expires_on,trial_ends_on,admin_notes,updated_at),business_module_entitlements(module_key,enabled)";
export async function readPlatformBusiness(id: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select(businessSelect).eq("id", id).single();
  if (!data || error) throw new AccessError(404, "Business not found.");
  return decorateBusiness(data);
}


export function decorateBusiness(value:unknown):BusinessRecord {
  const business=value as BusinessRecord;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const subscription=business.business_subscriptions;
  const end=subscription?.status==="trialing"
    ? [subscription.expires_on,subscription.trial_ends_on].filter((d):d is string=>!!d).sort()[0]??null
    : subscription?.expires_on??null;
  const expired=!!end&&end<today;
  const days=end?Math.round((Date.parse(end+"T00:00:00Z")-Date.parse(today+"T00:00:00Z"))/86400000):null;
  const effectiveStatus=subscription && expired&&["active","trialing"].includes(subscription.status) ? "expired"
    : subscription&&subscription.starts_on>today ? "scheduled" : subscription?.status??"unconfigured";
  const operational=business.business_status==="active"&&!!subscription&&["active","trialing"].includes(subscription.status)
    &&subscription.starts_on<=today&&!expired&&(subscription.status!=="trialing"||!!subscription.trial_ends_on);
  return {...business,access_summary:{operational,effectiveStatus,expiry:expired?"expired":days!==null&&days<=30?"expiring":"current"}};
}
