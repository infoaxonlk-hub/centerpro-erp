import {redirect} from "next/navigation";
import {requirePermission} from "@/lib/access";
import {SupplierCreateWorkspace} from "./supplier-create-workspace";
import type {SupplierField} from "@/components/supplier-excel-manager";
import type {StandardSupplierOverride} from "@/lib/supplier-field-config";

export default async function NewSupplierPage(){
  const {supabase,profile}=await requirePermission("masters");
  if(!["admin","super_admin"].includes(profile.role))redirect("/dashboard/masters?tab=suppliers");
  const [custom,standard]=await Promise.all([
    supabase.from("supplier_custom_fields")
      .select("id,field_key,label,field_type,is_required,is_active,sort_order")
      .eq("organization_id",profile.organization_id).order("sort_order"),
    supabase.from("supplier_standard_fields")
      .select("field_key,label,is_required,is_active")
      .eq("organization_id",profile.organization_id)
  ]);
  if(custom.error||standard.error)throw new Error("Could not load supplier field settings. Please refresh and try again.");
  return <SupplierCreateWorkspace organizationId={profile.organization_id}
    initialFields={(custom.data??[]) as SupplierField[]}
    initialStandardOverrides={(standard.data??[]) as StandardSupplierOverride[]}/>;
}
