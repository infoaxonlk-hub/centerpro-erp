"use client";

import Link from "next/link";
import { OfflinePosLink } from "@/components/offline-pos-link";
import { usePathname, useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  Building2,
  CircleDollarSign,
  ClipboardList,
  FileCheck2,
  LayoutDashboard,
  PackagePlus,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  permission?: string;
  adminOnly?: boolean;
  centerUserOrStock?: boolean;
  icon: LucideIcon;
  children?: { href: string; label: string; permission?: string }[];
};

type NavSection = {
  label: string;
  items: NavItem[];
};

export const sections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", permission: "dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/dashboard/purchases",
        label: "Purchases",
        permission: "purchases",
        icon: PackagePlus,
        children: [
          { href: "/dashboard/purchases/new", label: "New Purchase" },
          { href: "/dashboard/purchases", label: "Purchase Orders" },
          { href: "/dashboard/masters?tab=products", label: "Products", permission: "masters" },
          { href: "/dashboard/masters?tab=suppliers", label: "Suppliers", permission: "masters" },
        ],
      },
      {
        href: "/dashboard/sales",
        label: "Sales",
        permission: "sales",
        icon: ShoppingCart,
        children: [
          { href: "/dashboard/sales/new", label: "New Sale" },
          { href: "/dashboard/sales?view=orders", label: "Sales Orders" },
          { href: "/dashboard/sales?view=summary", label: "Sales Summary" },
          { href: "/dashboard/masters?tab=products", label: "Products", permission: "masters" },
          { href: "/dashboard/sales?view=customers", label: "Customers" },
        ],
      },
      { href: "/dashboard/stock", label: "Inventory / Stock", permission: "stock", icon: Boxes, children: [
        { href: "/dashboard/stock", label: "Stock explorer" },
        { href: "/dashboard/stock/transfers", label: "Internal transfers" },
        { href: "/dashboard/stock/adjustments", label: "Stock adjustment", permission: "stock_adjustment" },
        { href: "/dashboard/stock/movements", label: "Product movements" },
        { href: "/dashboard/stock/scrap", label: "Scrap" },
      ] },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/dashboard/sales/receivables", label: "Customer Receivable", permission: "sales", icon: ClipboardList },
      { href: "/dashboard/payment-reports/payables", label: "Supplier Payable", permission: "purchases", icon: ClipboardList },
      { href: "/dashboard/cash", label: "Cash & Payments", permission: "cash", icon: CircleDollarSign },
      { href: "/dashboard/expenses", label: "Expenses", permission: "cash", icon: Wallet },
      {
        href: "/dashboard/payment-reports/all",
        label: "Payments",
        permission: "payment_reports",
        icon: BarChart3,
        children: [
          { href: "/dashboard/payment-reports/all", label: "All Payments" },
          { href: "/dashboard/payment-reports/bank", label: "Bank Transactions" },
        ],
      },
      { href: "/dashboard/payment-reports/cheques", label: "Cheque Management", permission: "payment_reports", icon: FileCheck2 },
    ],
  },
  {
    label: "Configuration",
    items: [
      { href: "/dashboard/centers", label: "Centers & Locations", permission: "centers", icon: Building2 },
      { href: "/dashboard/masters", label: "Products & Suppliers", permission: "masters", icon: Settings },
      { href: "/dashboard/users", label: "Users & Access", permission: "users", adminOnly: true, icon: Users },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/dashboard/bill-requests", label: "Cancel Requests", adminOnly: true, icon: FileCheck2 },
      { href: "/dashboard/returns", label: "Return Requests", adminOnly: true, icon: RotateCcw },
      { href: "/dashboard/audit", label: "Audit Log", permission: "audit", icon: ShieldCheck },
    ],
  },
];

function isActive(pathname: string, href: string, query: string) {
  const [path, requiredQuery] = href.split("?");
  if (path === "/dashboard") return pathname === "/dashboard";
  if (path === "/dashboard/payment-reports/all") return pathname === path || pathname === "/dashboard/payment-reports/bank";
  if (requiredQuery) return pathname === path && new URLSearchParams(requiredQuery).toString() === query;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function SidebarNavigation({ permissions, isAdmin }: { permissions: string[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = Array.from(searchParams.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("&");
  const canSee = (item: NavItem) => (!item.adminOnly||isAdmin) && (item.centerUserOrStock ? (!isAdmin||permissions.includes("stock")) : !item.permission||permissions.includes(item.permission));

  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      {sections.map((section) => {
        const visible = section.items.filter(canSee);
        if (!visible.length) return null;
        return (
          <section className="nav-section" key={section.label}>
            <div className="nav-section-title">{section.label}</div>
            {visible.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href, query);
              return (
                <div className={`nav-group ${active ? "active" : ""}`} key={item.href}>
                  <Link className={`nav-item ${active ? "active" : ""}`} href={item.href} aria-current={active ? "page" : undefined}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                  {item.children && active && (
                    <div className="nav-submenu">
                      {item.children.filter(child=>!child.permission||permissions.includes(child.permission)).map((child) => {
                        const childActive = isActive(pathname, child.href, query);
                        const content = <><span className="nav-sub-dot" /><span>{child.label}</span></>;
                        return child.href === "/dashboard/purchases/new"
                          ? <OfflinePosLink className={childActive ? "active" : ""} href={child.href} key={child.href}>{content}</OfflinePosLink>
                          : <Link className={childActive ? "active" : ""} href={child.href} key={child.href} aria-current={childActive ? "page" : undefined}>{content}</Link>;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}
