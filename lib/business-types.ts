import type { BusinessModuleKey } from "./business-modules";
export type Subscription = { plan: "Starter"|"Professional"|"Enterprise"|"Custom"; status: "trialing"|"active"|"past_due"|"expired"|"cancelled"; starts_on:string; expires_on:string|null; trial_ends_on:string|null; admin_notes:string };
export type BusinessRecord = {
 id:string; name:string; business_status:string; receipt_address:string|null; receipt_phone:string|null; receipt_email:string|null; created_at:string;
 profiles:{id:string;full_name:string;email:string;role:string;is_active:boolean}[];
 business_subscriptions:Subscription|null;
 business_module_entitlements:{module_key:BusinessModuleKey;enabled:boolean}[];
 access_summary?:{operational:boolean;expiry:string;effectiveStatus:string};
};
export type SubscriptionHistory = {id:number;before_data:Subscription|null;after_data:Subscription;created_at:string};
