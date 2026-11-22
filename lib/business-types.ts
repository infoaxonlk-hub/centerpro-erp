import type { BusinessModuleKey } from "./business-modules";
export type Subscription = { plan: "Starter"|"Professional"|"Enterprise"|"Custom"; status: "trialing"|"active"|"past_due"|"expired"|"cancelled"; starts_on:string; expires_on:string|null; trial_ends_on:string|null; admin_notes:string };
export type BusinessRecord = {
 id:string; name:string; business_status:string; receipt_address:string|null; receipt_phone:string|null; receipt_email:string|null; created_at:string; archived_at:string|null; archived_by:string|null; archive_reason:string|null; pre_archive_status:string|null;
 profiles:{id:string;full_name:string;email:string;role:string;is_active:boolean;permissions:string[]}[];
 business_subscriptions:Subscription|null;
 business_module_entitlements:{module_key:BusinessModuleKey;enabled:boolean}[];
 access_summary?:{operational:boolean;expiry:string;effectiveStatus:string};
};
export type SubscriptionHistory = {id:number;before_data:Subscription|null;after_data:Subscription;created_at:string};

export type BusinessLifecycleAudit = { id:string; request_id:string; business_id:string; business_name:string; action:'archived'|'restored'; actor_id:string; actor_name:string; reason:string; before_status:string; after_status:string; created_at:string };
