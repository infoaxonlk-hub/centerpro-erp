"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, Home } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const labels: Record<string, string> = {
  dashboard: "Dashboard",
  purchases: "Purchases",
  sales: "Sales",
  stock: "Stock",
  labor: "Labor & Sessions",
  laborers: "Laborers",
  sessions: "Sessions",
  cash: "Cash Manage",
  bank: "Bank Management",
  accounts: "Bank Accounts",
  statement: "Bank Statement",
  available: "Cash Management",
  handovers: "Cash handover history",
  ledger: "Cash Ledger",
  "top-ups": "Center cash top-ups",
  "bank-accounts": "Company bank accounts",
  expenses: "Expenses",
  "payment-reports": "Payment Reports",
  all: "All Payments",
  
  payables: "Supplier Payables",
  cheques: "Cheque Management",
  centers: "Centers & Locations",
  masters: "Products & Suppliers",
  users: "Users & Access",
  audit: "Audit Log",
  "bill-requests": "Cancel Requests",
  returns: "Return Requests",
  receivables: "Customer Receivables",
  products: "Products",
  suppliers: "Suppliers",
  customers: "Customers",
  summary: "Sales summary",
  new: "New",
};

function parentHref(pathname: string) {
  if (pathname.startsWith("/dashboard/labor/sessions/")) return "/dashboard/labor/sessions";
  if (/^\/dashboard\/purchases\/[^/]+$/.test(pathname)) return "/dashboard/purchases";
  if (/^\/dashboard\/sales\/[^/]+$/.test(pathname)) return "/dashboard/sales";
  if (pathname === "/dashboard/sales/receivables") return "/dashboard/sales";
  if (pathname === "/dashboard/cash/ledger") return "/dashboard/cash/available";
  if (pathname.startsWith("/dashboard/bank/")) return "/dashboard/bank/accounts";
  if (pathname === "/dashboard/payment-reports/all") return "/dashboard";
  if (pathname.startsWith("/dashboard/payment-reports/")) return "/dashboard/payment-reports/all";
  return "/dashboard";
}

function currentTitle(parts: string[]) {
  const last = parts.at(-1) ?? "dashboard";
  if (last === "new") return parts.includes("sales") ? "New Sale" : "New Purchase";
  if (parts.includes("labor") && parts.includes("sessions") && parts.length>3) return "Session details";
  if (!labels[last] && parts.includes("purchases")) return "Purchase Bill";
  if (!labels[last] && parts.includes("sales")) return "Sales Invoice";
  return labels[last] ?? "Details";
}

export function ContextNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/dashboard" || pathname === "/dashboard/purchases/new" || pathname === "/dashboard/sales/new") return null;

  const parts = pathname.split("/").filter(Boolean);
  const title = currentTitle(parts);
  const parent = parentHref(pathname);
  const crumbs: { label: string; href?: string }[] = [{ label: "Dashboard", href: "/dashboard" }];

  if (parts.length > 2) {
    const module = parts[1];
    const moduleHref = `/dashboard/${module}`;
    const moduleLabel = labels[module] ?? module.replaceAll("-", " ");
    if (module === "payment-reports") crumbs.push({ label: "Payment Reports", href: "/dashboard/payment-reports/all" });
    else crumbs.push({ label: moduleLabel, href: moduleHref });
  }
  if (crumbs.at(-1)?.label !== title) crumbs.push({ label: title });

  return (
    <div className="context-nav">
      <button className="context-back" type="button" onClick={() => {
        router.push(parent);
      }}>
        <ArrowLeft size={17} />
        <span>Back</span>
      </button>
      <div className="breadcrumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb, index) => (
          <span className="breadcrumb-piece" key={`${crumb.label}-${index}`}>
            {index > 0 && <ChevronRight size={14} />}
            {crumb.href ? <Link href={crumb.href}>{index === 0 ? <><Home size={14}/> {crumb.label}</> : crumb.label}</Link> : <strong>{crumb.label}</strong>}
          </span>
        ))}
      </div>
    </div>
  );
}
