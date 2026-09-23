import Link from "next/link";
import { BarChart3, Building2, Boxes, CircleDollarSign, LayoutDashboard, PackagePlus, ReceiptText, Settings, ShieldCheck, Users, Wallet } from "lucide-react";
import { logout } from "@/app/login/actions";
import {NotificationBell,type AdminNotification} from "@/components/notification-bell";

const nav = [
  ["/dashboard", "Dashboard", LayoutDashboard],
  ["/dashboard/purchases", "Purchases", PackagePlus],
  ["/dashboard/sales", "Sales", ReceiptText],
  ["/dashboard/stock", "Stock", Boxes],
  ["/dashboard/cash", "Cash & Payments", CircleDollarSign],
  ["/dashboard/expenses", "Expenses", Wallet],
  ["/dashboard/payment-reports", "Payment Reports", BarChart3],
  ["/dashboard/centers", "Centers & Locations", Building2],
  ["/dashboard/users", "Users", Users],
  ["/dashboard/masters", "Products & Suppliers", Settings],
  ["/dashboard/audit", "Audit", ShieldCheck],
] as const;

export function AppShell({ children, name, role, permissions,notifications,isAdmin,assignedCenters,demoNotice }: { children: React.ReactNode; name: string; role: string; permissions: string[];notifications:AdminNotification[];isAdmin:boolean;assignedCenters:string[];demoNotice?:{endDate:string;message:string}|null }) {
  const canSee=(href:string)=>permissions.includes(href==="/dashboard"?"dashboard":href==="/dashboard/expenses"?"cash":href.split("/")[2].replaceAll("-","_"));
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const daysLeft=demoNotice?Math.round((Date.parse(`${demoNotice.endDate}T00:00:00Z`)-Date.parse(`${today}T00:00:00Z`))/86400000):0;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="logo"><span>CP</span><div><strong>CenterPro</strong><small>by InfoAxon</small></div></div>
      <nav>{nav.filter(([href])=>canSee(href)).map(([href,label,Icon])=>href==="/dashboard/payment-reports"?<div className="nav-report-group" key={href}><Link href="/dashboard/payment-reports/all"><Icon size={18}/><span>{label}</span></Link><div className="nav-submenu"><Link href="/dashboard/payment-reports/all">All Payments</Link><Link href="/dashboard/payment-reports/bank">Bank Transactions</Link><Link href="/dashboard/payment-reports/payables">Supplier Payables</Link><Link href="/dashboard/payment-reports/cheques">Cheque Management</Link></div></div>:<Link href={href} key={href}><Icon size={18}/><span>{label}</span></Link>)}{permissions.includes("sales")&&<Link href="/dashboard/sales/receivables"><ReceiptText size={18}/><span>Customer Receivables</span></Link>}{permissions.includes("purchases")&&!permissions.includes("payment_reports")&&<Link href="/dashboard/payment-reports/payables"><CircleDollarSign size={18}/><span>Supplier Payables</span></Link>}{isAdmin&&<Link href="/dashboard/bill-requests"><ShieldCheck size={18}/><span>Cancel Requests</span></Link>}</nav>
      <div className="sidebar-foot"><ReceiptText size={18}/><span>Pilot workspace</span></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><strong>{name}</strong><small>{role.replaceAll("_", " ")}</small>{!isAdmin&&assignedCenters.length>0&&<span className="current-center">{assignedCenters.length===1?assignedCenters[0]:`${assignedCenters.length} assigned centers`}</span>}</div><div className="topbar-actions"><NotificationBell initialNotifications={notifications}/><form action={logout}><button className="ghost">Sign out</button></form></div></header>
      {demoNotice&&<div className="demo-notice" role="status"><strong>DEMO</strong><span>{demoNotice.message} {daysLeft>0?`${daysLeft} day${daysLeft===1?"":"s"} remaining.`:daysLeft===0?"Ends today.":"Demo period ended."}</span><small>End date: {demoNotice.endDate}</small></div>}
      <main className="page-content">{children}</main>
    </section>
  </div>;
}

