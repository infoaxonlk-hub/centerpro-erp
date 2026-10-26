import "@/app/appearance.css";
import { AppearanceShell } from "@/components/appearance-shell";
import { ActionSubmit } from "@/components/action-submit";
﻿import { ReceiptText } from "lucide-react";
import { logout } from "@/app/login/actions";
import { NotificationBell, type AdminNotification } from "@/components/notification-bell";
import { SidebarNavigation } from "@/components/sidebar-navigation";
import { ContextNavigation } from "@/components/context-navigation";

export function AppShell({ children, companyName, name, role, permissions, notifications, isAdmin, assignedCenters, demoNotice }: { children: React.ReactNode; companyName?: string; name: string; role: string; permissions: string[]; notifications: AdminNotification[]; isAdmin: boolean; assignedCenters: string[]; demoNotice?: { endDate: string; message: string } | null }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const daysLeft = demoNotice ? Math.round((Date.parse(`${demoNotice.endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : 0;
  return <AppearanceShell permissions={permissions} isAdmin={isAdmin} companyName={companyName} centerNames={assignedCenters}>
    <aside className="sidebar">
      <div className="logo"><span>CP</span><div><strong>CenterPro</strong><small>by InfoAxon</small></div></div>
      <SidebarNavigation permissions={permissions} isAdmin={isAdmin} isSuperAdmin={role === "super_admin"} />
      <div className="sidebar-foot"><ReceiptText size={18}/><span>Pilot workspace</span></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><strong>{name}</strong><small>{role.replaceAll("_", " ")}</small>{!isAdmin&&assignedCenters.length>0&&<span className="current-center">{assignedCenters.length===1?assignedCenters[0]:`${assignedCenters.length} assigned centers`}</span>}</div><div className="topbar-actions"><NotificationBell initialNotifications={notifications}/><span id="appearance-settings-slot" /><form action={logout}><ActionSubmit label="Sign out" pendingLabel="Signing out…" className="ghost" /></form></div></header>
      {demoNotice&&<div className="demo-notice" role="status"><strong>DEMO</strong><span>{demoNotice.message} {daysLeft>0?`${daysLeft} day${daysLeft===1?"":"s"} remaining.`:daysLeft===0?"Ends today.":"Demo period ended."}</span><small>End date: {demoNotice.endDate}</small></div>}
      <ContextNavigation />
      <main className="page-content">{children}</main>
    </section>
  </AppearanceShell>;
}
