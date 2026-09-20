import Link from "next/link";
import { BarChart3, Building2, Boxes, CircleDollarSign, LayoutDashboard, PackagePlus, ReceiptText, Settings, ShieldCheck, Users } from "lucide-react";
import { logout } from "@/app/login/actions";
import {NotificationBell,type AdminNotification} from "@/components/notification-bell";

const nav = [
  ["/dashboard", "Dashboard", LayoutDashboard],
  ["/dashboard/purchases", "Purchases", PackagePlus],
  ["/dashboard/stock", "Stock", Boxes],
  ["/dashboard/cash", "Cash & Payments", CircleDollarSign],
  ["/dashboard/payment-reports", "Payment Reports", BarChart3],
  ["/dashboard/centers", "Centers & Locations", Building2],
  ["/dashboard/users", "Users", Users],
  ["/dashboard/masters", "Products & Suppliers", Settings],
  ["/dashboard/audit", "Audit", ShieldCheck],
] as const;

export function AppShell({ children, name, role, permissions,notifications,isAdmin,assignedCenters }: { children: React.ReactNode; name: string; role: string; permissions: string[];notifications:AdminNotification[];isAdmin:boolean;assignedCenters:string[] }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="logo"><span>CP</span><div><strong>CollectPro</strong><small>by InfoAxon</small></div></div>
      <nav>{nav.filter(([href])=>permissions.includes(href==="/dashboard"?"dashboard":href.split("/")[2].replaceAll("-","_"))).map(([href,label,Icon])=>href==="/dashboard/payment-reports"?<div className="nav-report-group" key={href}><Link href="/dashboard/payment-reports/all"><Icon size={18}/><span>{label}</span></Link><div className="nav-submenu"><Link href="/dashboard/payment-reports/all">All Payments</Link><Link href="/dashboard/payment-reports/bank">Bank Transactions</Link><Link href="/dashboard/payment-reports/payables">Payable Report</Link><Link href="/dashboard/payment-reports/cheques">Cheque Management</Link></div></div>:<Link href={href} key={href}><Icon size={18}/><span>{label}</span></Link>)}</nav>
      <div className="sidebar-foot"><ReceiptText size={18}/><span>Pilot workspace</span></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><strong>{name}</strong><small>{role.replaceAll("_", " ")}</small>{!isAdmin&&assignedCenters.length>0&&<span className="current-center">{assignedCenters.length===1?assignedCenters[0]:`${assignedCenters.length} assigned centers`}</span>}</div><div className="topbar-actions"><NotificationBell initialNotifications={notifications}/><form action={logout}><button className="ghost">Sign out</button></form></div></header>
      <main className="page-content">{children}</main>
    </section>
  </div>;
}
