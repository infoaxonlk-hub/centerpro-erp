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
  UsersRound,
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
  permissionsAny?: string[];
  adminOnly?: boolean;
  centerUserOrStock?: boolean;
  icon: LucideIcon;
  children?: { href: string; label: string; permission?: string; centerUserOrStock?: boolean }[];
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
          { href: "/dashboard/purchases/new", label: "New purchase" },
          { href: "/dashboard/purchases", label: "Purchase orders" },
          { href: "/dashboard/purchases/products", label: "Products" },
          { href: "/dashboard/purchases/suppliers", label: "Suppliers" },
        ],
      },
      {
        href: "/dashboard/sales",
        label: "Sales",
        permission: "sales",
        icon: ShoppingCart,
        children: [{ href: "/dashboard/sales/new", label: "New sale" }, { href: "/dashboard/sales", label: "Sales orders" }, { href: "/dashboard/sales/summary", label: "Sales summary" }, { href: "/dashboard/sales/products", label: "Products" }, { href: "/dashboard/sales/customers", label: "Customers" }],
      },
      { href: "/dashboard/stock", label: "Inventory", centerUserOrStock: true, icon: Boxes, children: [
        { href: "/dashboard/stock", label: "Stock explorer", permission: "stock" },
        { href: "/dashboard/stock/transfers", label: "Internal transfers", permission: "stock" },
        { href: "/dashboard/stock/adjustments", label: "Stock adjustment", permission: "stock_adjustment" },
        { href: "/dashboard/stock/movements", label: "Product movements", permission: "stock" },
        { href: "/dashboard/stock/scrap", label: "Scrap stock", centerUserOrStock: true },
      ] },
      { href: "/dashboard/labor", label: "Labor & Sessions", permission: "labor", icon: UsersRound },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/dashboard/sales/receivables", label: "Customer receivables", permission: "sales", icon: ClipboardList },
      { href: "/dashboard/payment-reports/payables", label: "Supplier payables", permissionsAny: ["purchases","payment_reports"], icon: ClipboardList },
      { href: "/dashboard/payment-reports/cheques", label: "Cheque management", permission: "payment_reports", icon: FileCheck2 },
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

export function canSeeNavigation(item: {permission?:string;permissionsAny?:string[];adminOnly?:boolean;centerUserOrStock?:boolean}, permissions:string[], isAdmin:boolean) {
  return (!item.adminOnly || isAdmin) && (item.centerUserOrStock ? (!isAdmin || permissions.includes("stock")) : item.permissionsAny ? item.permissionsAny.some(p=>permissions.includes(p)) : !item.permission || permissions.includes(item.permission));
}
export function activeNavigation(pathname:string, items:NavItem[]) {
  return items.filter(item=>item.href!=="/dashboard" && (pathname===item.href || pathname.startsWith(item.href+"/") || item.children?.some(c=>pathname===c.href || pathname.startsWith(c.href+"/")))).sort((a,b)=>b.href.length-a.href.length)[0];
}

export function SidebarNavigation({ permissions, isAdmin }: { permissions: string[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const canSee = (item: NavItem) => canSeeNavigation(item, permissions, isAdmin);
  const activeItem = activeNavigation(pathname, sections.flatMap(s=>s.items).filter(canSee));

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
              const active = item.href === "/dashboard" ? pathname === item.href : activeItem?.href === item.href;
              return (
                <div className={`nav-group ${active ? "active" : ""}`} key={item.href}>
                  <Link className={`nav-item ${active ? "active" : ""}`} href={item.href} aria-current={active ? "page" : undefined}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                  {item.children && active && (
                    <div className="nav-submenu">
                      {item.children.filter(child=>canSeeNavigation(child,permissions,isAdmin)).map((child) => {
                        const childActive = pathname === child.href;
                        const content = <><span className="nav-sub-dot" /><span>{child.label}</span></>;
                        return child.href.endsWith("/new")
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
