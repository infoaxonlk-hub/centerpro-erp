import { requirePermission } from "@/lib/access";
import { PurchaseForm } from "./purchase-form";
export default async function NewPurchasePage() {
  const { supabase: s, profile } = await requirePermission("purchases");
  const [
    { data: centers },
    { data: suppliers },
    { data: products },
    { data: prices },
    { data: organization },
    { data: bankAccounts },
    { data: laborSessions },
  ] = await Promise.all([
    s
      .from("centers")
      .select(
        "id,code,name,allow_multiple_locations,locations(id,code,name,is_default,is_active)",
      )
      .eq("is_active", true)
      .order("name"),
    s
      .from("suppliers")
      .select("id,name,phone")
      .eq("is_active", true)
      .order("name"),
    s
      .from("products")
      .select(
        "id,code,name,category,unit_of_measure,product_qualities(id,name,default_price,is_active,is_base)",
      )
      .eq("is_active", true)
      .order("name"),
    s.from("center_prices").select("center_id,quality_id,price"),
    s
      .from("organizations")
      .select("name")
      .eq("id", profile.organization_id)
      .single(),
    s
      .from("bank_accounts")
      .select(
        "id,account_number,account_name,branch_name,branch_code,payment_banks(id,code,name,is_active)",
      )
      .eq("is_active", true)
      .order("account_number"),
    (profile.role==="admin"||profile.role==="super_admin"||(profile.permissions??[]).includes("labor"))
      ? s.from("labor_sessions").select("id,center_id,title,operation,session_date").eq("status","open").in("operation",["purchase","both"]).order("session_date",{ascending:false})
      : Promise.resolve({data:[]} as {data:never[]}),
  ]);
  return (
    <PurchaseForm
      centers={centers ?? []}
      suppliers={suppliers ?? []}
      organizationId={profile.organization_id}
      products={products ?? []}
      prices={prices ?? []}
      bankAccounts={bankAccounts ?? []}
      organizationName={organization?.name ?? "CenterPro"}
      userName={profile.full_name}
      scopeId={profile.id}
      laborSessions={laborSessions??[]}
    />
  );
}
