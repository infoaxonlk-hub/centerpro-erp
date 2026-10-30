// Shared by route guards, navigation, provisioning and database catalogue tests.
export const businessModules = [
  { key: "dashboard", name: "Dashboard", href: "/dashboard", permissions: ["dashboard"], required: true },
  { key: "purchases", name: "Purchases", href: "/dashboard/purchases", permissions: ["purchases"] },
  { key: "farm_services", name: "Farm Services", href: "/dashboard/farm-services", permissions: ["farm_services", "farm_services_manage"] },
  { key: "sales", name: "Sales", href: "/dashboard/sales", permissions: ["sales"] },
  { key: "inventory", name: "Inventory / Stock", href: "/dashboard/stock", permissions: ["stock"] },
  { key: "manufacturing", name: "Manufacturing", href: "/dashboard/manufacturing", permissions: ["manufacturing"], parent: "inventory" },
  { key: "stock_transfers", name: "Stock Transfers", href: "/dashboard/stock/transfers", permissions: ["stock"], parent: "inventory" },
  { key: "stock_adjustments", name: "Stock Adjustments", href: "/dashboard/stock/adjustments", permissions: ["stock_adjustment"], parent: "inventory" },
  { key: "labor", name: "Labor & Sessions", href: "/dashboard/labor", permissions: ["labor"], parent: "expenses" },
  { key: "cash", name: "Cash Management", href: "/dashboard/cash", permissions: ["cash"] },
  { key: "bank", name: "Bank Management", href: "/dashboard/bank", permissions: ["cash"], adminOnly: true },
  { key: "expenses", name: "Expenses", href: "/dashboard/expenses", permissions: ["cash"] },
  { key: "payment_reports", name: "Payment Reports", href: "/dashboard/payment-reports", permissions: ["payment_reports"] },
  { key: "cheques", name: "Cheque Management", href: "/dashboard/payment-reports/cheques", permissions: ["payment_reports"] },
  { key: "customer_receivables", name: "Customer Receivables", href: "/dashboard/sales/receivables", permissions: ["sales"], parent: "sales" },
  { key: "supplier_payables", name: "Supplier Payables", href: "/dashboard/payment-reports/payables", permissions: ["purchases", "payment_reports"] },
  { key: "centers", name: "Centers & Locations", href: "/dashboard/centers", permissions: ["centers"] },
  { key: "masters", name: "Products & Suppliers", href: "/dashboard/masters", permissions: ["masters"] },
  { key: "users", name: "Users & Access", href: "/dashboard/users", permissions: ["users"], adminOnly: true },
  { key: "audit", name: "Audit Log", href: "/dashboard/audit", permissions: ["audit"] },
] as const;
export type BusinessModuleKey = typeof businessModules[number]["key"];
export const moduleKeys = businessModules.map(m => m.key);
export function moduleForPath(path: string): BusinessModuleKey | null {
  const pathname = path.split("?")[0].replace(/\/$/, "") || "/";
  if (/^\/dashboard\/(businesses|account|restricted)(\/|$)/.test(pathname)) return null;
  // Legacy bank-account route belongs to Bank Management.
  if (pathname.startsWith("/dashboard/cash/bank-accounts")) return "bank";
  return [...businessModules].sort((a,b) => b.href.length-a.href.length)
    .find(m => pathname === m.href || (m.href !== "/dashboard" && pathname.startsWith(m.href + "/")))?.key
    ?? (pathname.startsWith("/dashboard/") ? "dashboard" : null);
}
export function moduleEnabled(key: string, enabled: readonly string[]): boolean {
  const definition = businessModules.find(m => m.key === key);
  if (!definition) return false;
  return enabled.includes(key) && (!("parent" in definition) || moduleEnabled(definition.parent, enabled));
}
export function routeLocked(href: string, enabled: readonly string[]): boolean {
  const key = moduleForPath(href);
  return !!key && !moduleEnabled(key, enabled);
}
export function restrictedHref(href: string): string {
  return "/dashboard/restricted?module=" + encodeURIComponent(moduleForPath(href) ?? "dashboard");
}
export function normalizeModules(selected: readonly string[]): BusinessModuleKey[] {
  const chosen = new Set<string>(["dashboard", ...selected]);
  for (const item of businessModules) {
    if (chosen.has(item.key) && "parent" in item) chosen.add(item.parent);
  }
  return moduleKeys.filter(key => chosen.has(key));
}
export type BusinessAccess = {
  organizationId: string; businessName: string; businessStatus: string;
  operational: boolean; reason: string | null; enabledModules: BusinessModuleKey[];
  userPermissions?: string[]; userRole?: string;
  subscription: { plan: string; status: string; starts_on: string; expires_on: string | null; trial_ends_on: string | null };
};
export const suspensionMessage = "Your business account is temporarily suspended. Please contact InfoAxon Support for assistance.";


export function permissionEntitled(permission:string,enabled:readonly string[]):boolean {
  if(permission==="product_create"||permission==="product_edit")return moduleEnabled("masters",enabled);
  return businessModules.some(item=>(item.permissions as readonly string[]).includes(permission)&&moduleEnabled(item.key,enabled));
}

export function permissionsForModules(modules:readonly string[]):string[] {
  const permissions=new Set<string>(["dashboard"]);
  for(const item of businessModules)if(moduleEnabled(item.key,modules))for(const permission of item.permissions)permissions.add(permission);
  if(permissions.has("masters")){permissions.add("product_create");permissions.add("product_edit");}
  if(permissions.has("stock_adjustment"))permissions.add("stock");
  return [...permissions];
}
