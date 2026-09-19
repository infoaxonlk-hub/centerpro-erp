import Link from "next/link";
import { Building2, Boxes, CircleDollarSign, LayoutDashboard, PackagePlus, ReceiptText, Settings, ShieldCheck, Users } from "lucide-react";
import { logout } from "@/app/login/actions";

const nav = [
  ["/dashboard", "Dashboard", LayoutDashboard],
  ["/dashboard/purchases", "Purchases", PackagePlus],
  ["/dashboard/stock", "Stock", Boxes],
  ["/dashboard/cash", "Cash & Payments", CircleDollarSign],
  ["/dashboard/centers", "Centers & Locations", Building2],
  ["/dashboard/users", "Users", Users],
  ["/dashboard/masters", "Products & Suppliers", Settings],
  ["/dashboard/audit", "Audit", ShieldCheck],
] as const;

export function AppShell({ children, name, role }: { children: React.ReactNode; name: string; role: string }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="logo"><span>CP</span><div><strong>CollectPro</strong><small>by InfoAxon</small></div></div>
      <nav>{nav.map(([href,label,Icon])=><Link href={href} key={href}><Icon size={18}/><span>{label}</span></Link>)}</nav>
      <div className="sidebar-foot"><ReceiptText size={18}/><span>Pilot workspace</span></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><strong>{name}</strong><small>{role.replaceAll("_", " ")}</small></div><form action={logout}><button className="ghost">Sign out</button></form></header>
      <main className="page-content">{children}</main>
    </section>
  </div>;
}
