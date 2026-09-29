"use client";

import Link from "next/link";
import { OfflinePosLink } from "@/components/offline-pos-link";
import { usePathname } from "next/navigation";
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
  Trash2,
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
  children?: { href: string; label: string }[];
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const sections: NavSection[] = [
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
          { href: "/dashboard/purchases", label: "Order List" },
          { href: "/dashboard/purchases/new", label: "New Purchase" },
        ],
      },
      {
        href: "/dashboard/sales",
        label: "Sales",
        permission: "sales",
        icon: ShoppingCart,
        children: [{ href: "/dashboard/sales/receivables", label: "Customer Receivables" }],
      },
      { href: "/dashboard/stock", label: "Inventory / Stock", permission: "stock", icon: Boxes, children: [
        { href: "/dashboard/stock", label: "Stock explorer" },
        { href: "/dashboard/stock/transfers", label: "Internal transfers" },
        { href: "/dashboard/stock/adjustments", label: "Stock adjustment" },
        { href: "/dashboard/stock/movements", label: "Product movements" },
      ] },
      { href: "/dashboard/stock/scrap", label: "Scrap stock", centerUserOrStock: true, icon: Trash2 },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/dashboard/cash", label: "Cash & Payments", permission: "cash", icon: CircleDollarSign },
      { href: "/dashboard/expenses", label: "Expenses", permission: "cash", icon: Wallet },
      {
        href: "/dashboard/payment-reports/all",
        label: "Payment Reports",
        permission: "payment_reports",
        icon: BarChart3,
        children: [
          { href: "/dashboard/payment-reports/all", label: "All Payments" },
          { href: "/dashboard/payment-reports/bank", label: "Bank Transactions" },
          { href: "/dashboard/payment-reports/payables", label: "Supplier Payables" },
          { href: "/dashboard/payment-reports/cheques", label: "Cheque Management" },
        ],
      },
    ],
  },
  {
    label: "Configuration",
    items: [
      { href: "/dashboard/centers", label: "Centers & Locations", permission: "centers", icon: Building2 },
      { href: "/dashboard/masters", label: "Products & Suppliers", permission: "masters", icon: Settings },
      { href: "/dashboard/users", label: "Users & Access", permission: "users", icon: Users },
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

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/payment-reports/all") return pathname.startsWith("/dashboard/payment-reports");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNavigation({ permissions, isAdmin }: { permissions: string[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const canSee = (item: NavItem) => item.adminOnly ? isAdmin : item.centerUserOrStock ? (!isAdmin || permissions.includes("stock")) : !item.permission || permissions.includes(item.permission);

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
              const active = isActive(pathname, item.href);
              return (
                <div className={`nav-group ${active ? "active" : ""}`} key={item.href}>
                  <Link className={`nav-item ${active ? "active" : ""}`} href={item.href} aria-current={active ? "page" : undefined}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                  {item.children && active && (
                    <div className="nav-submenu">
                      {item.children.map((child) => {
                        const childActive = pathname === child.href;
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
      {permissions.includes("purchases") && !permissions.includes("payment_reports") && (
        <section className="nav-section">
          <div className="nav-section-title">Finance</div>
          <Link className={`nav-item ${pathname === "/dashboard/payment-reports/payables" ? "active" : ""}`} href="/dashboard/payment-reports/payables">
            <ClipboardList size={18} />
            <span>Supplier Payables</span>
          </Link>
        </section>
      )}
    </nav>
  );
}
