import {readCashLedger} from "@/lib/cash-ledger";
import Link from "next/link";
import {businessModules,moduleEnabled,restrictedHref} from "@/lib/business-modules";
import { requirePermission } from "@/lib/access";
import { BellRing, Building2, CalendarClock, CircleDollarSign, PackagePlus, Settings, ShieldCheck, TriangleAlert, Users, Wallet, Boxes, BarChart3, Landmark, LockKeyhole } from "lucide-react";

const money = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  maximumFractionDigits: 0,
});

const moduleIcons: Record<string,typeof PackagePlus> = {purchases:PackagePlus,sales:PackagePlus,inventory:Boxes,stock_transfers:Boxes,stock_adjustments:Boxes,labor:Users,cash:CircleDollarSign,bank:Landmark,expenses:Wallet,payment_reports:BarChart3,cheques:CalendarClock,customer_receivables:BarChart3,supplier_payables:BarChart3,centers:Building2,masters:Settings,users:Users,audit:ShieldCheck};
const appModules = businessModules.filter(m=>m.key!=="dashboard").map(m=>({
 href:m.href, key:m.key, title:m.name, permissions:m.permissions as readonly string[], adminOnly:"adminOnly" in m&&m.adminOnly,
 text:"Open "+m.name.toLowerCase(),icon:moduleIcons[m.key]??PackagePlus,tone:"violet",
}));

export default async function DashboardPage() {
  const { supabase, profile, business } = await requirePermission("dashboard");
  const isAdmin = ["super_admin", "admin"].includes(profile.role);
  const can=(key:string,permission:string)=>moduleEnabled(key,business.enabledModules)&&profile.permissions.includes(permission);
  const modules = appModules.filter(item => (!item.adminOnly||isAdmin||!moduleEnabled(item.key,business.enabledModules)) && (!moduleEnabled(item.key,business.enabledModules)||item.permissions.some(p=>profile.permissions.includes(p))));
  const [
    { count: centers },
    { count: purchases },
    { data: stock },
    { data: cash },
    { data: organization },
    { data: cheques },
    { data: priceAlerts },
  ] = await Promise.all([
    can("centers","centers") ? supabase
      .from("centers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true) : Promise.resolve({count:0}),
    can("purchases","purchases") ? supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "confirmed") : Promise.resolve({count:0}),
    can("inventory","stock") ? supabase.from("stock_movements").select("quantity,movement_type") : Promise.resolve({data:[]}),
    can("cash","cash") ? readCashLedger(supabase) : Promise.resolve({data:[]}),
    supabase
      .from("organizations")
      .select("cheque_reminder_days")
      .eq("id", profile.organization_id)
      .single(),
    isAdmin && can("cheques","payment_reports")
      ? supabase
          .from("payments")
          .select(
            "id,amount,cheque_number,cheque_date,cheque_status,centers(name,code),purchase_orders(po_number,suppliers(name))",
          )
          .eq("method", "cheque")
          .in("cheque_status", ["pending", "deposited"])
          .order("cheque_date", { ascending: true })
      : Promise.resolve({ data: [] }),
    isAdmin && can("purchases","purchases")
      ? supabase
          .from("notifications")
          .select("id,title,message,is_read,created_at,centers(name,code)")
          .eq("type", "price_override")
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
  ]);
  const stockQty = (stock ?? []).reduce(
    (sum, row) =>
      sum +
      (["purchase_in", "transfer_in", "adjustment_in"].includes(
        row.movement_type,
      )
        ? Number(row.quantity)
        : -Number(row.quantity)),
    0,
  );
  const cashBalance = (cash ?? []).reduce(
    (sum, row) =>
      sum +
      (["allocation", "refund", "sale_receipt"].includes(row.movement_type)
        ? Number(row.amount)
        : -Number(row.amount)),
    0,
  );
  const reminderDays = organization?.cheque_reminder_days ?? 3;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayMs = new Date(`${today}T00:00:00+05:30`).getTime();
  const reminders = (cheques ?? [])
    .map((row) => ({
      ...row,
      diff: Math.ceil(
        (new Date(`${row.cheque_date}T00:00:00+05:30`).getTime() - todayMs) /
          86400000,
      ),
    }))
    .filter((row) => row.diff <= reminderDays);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow dark">OPERATIONS</span>
          <h1>Business overview</h1>
          <p>
            Live position across your permitted business modules.
          </p>
        </div>
        <Link className="primary" href="/dashboard/centers">
          Manage centers
        </Link>
      </div>
      <section className="dashboard-apps" aria-label="CenterPro modules">
        <div className="dashboard-apps-heading"><div><span className="eyebrow dark">APPLICATIONS</span><h2>Open a workspace</h2></div><p>Quick access to the modules available for your account.</p></div>
        <div className="app-card-grid">{modules.map((module) => {const Icon=module.icon;return <Link href={moduleEnabled(module.key,business.enabledModules)?module.href:restrictedHref(module.href)} className={`app-card ${module.tone} ${moduleEnabled(module.key,business.enabledModules)?"":"module-locked"}`} key={module.href}><span className="app-card-icon"><Icon/></span><span><b>{module.title}</b><small>{module.text}</small></span><i>{moduleEnabled(module.key,business.enabledModules)?"Open":<span className="module-lock"><LockKeyhole size={14}/> Locked</span>}</i></Link>})}</div>
      </section>
      <section className="metric-grid">
        <article className="metric accent">
          <span>Active centers</span>
          <strong>{centers ?? 0}</strong>
          <small>Configured locations included</small>
        </article>
        <article className="metric">
          <span>Confirmed purchases</span>
          <strong>{purchases ?? 0}</strong>
          <small>All recorded purchase orders</small>
        </article>
        <article className="metric">
          <span>Stock quantity</span>
          <strong>
            {stockQty.toLocaleString("en-LK", { maximumFractionDigits: 3 })} kg
          </strong>
          <small>Movement-ledger balance</small>
        </article>
        <article className="metric">
          <span>Available center cash</span>
          <strong>{money.format(cashBalance)}</strong>
          <small>Cash receipts and sales less purchases</small>
        </article>
      </section>
      {isAdmin && can("purchases","purchases") && (
        <section className="panel dashboard-notifications price-alerts">
          <div className="notification-heading">
            <div>
              <span className="notification-icon">
                <BellRing />
              </span>
              <div>
                <h2>Purchase price change alerts</h2>
                <p>
                  Purchases entered with a price different from the configured
                  center price.
                </p>
              </div>
            </div>
            <Link href="/dashboard/purchases">View purchases</Link>
          </div>
          <div className="notification-list">
            {(priceAlerts ?? []).map((row) => {
              const c = Array.isArray(row.centers)
                ? row.centers[0]
                : row.centers;
              return (
                <article
                  className={row.is_read ? "read-alert" : "price-alert"}
                  key={row.id}
                >
                  <TriangleAlert />
                  <div>
                    <b>{row.title}</b>
                    <span>
                      {row.message} Â· {c?.code} Â·{" "}
                      {new Date(row.created_at).toLocaleString("en-LK")}
                    </span>
                  </div>
                  <strong>{row.is_read ? "Read" : "New"}</strong>
                </article>
              );
            })}
            {!priceAlerts?.length && (
              <div className="notification-empty">
                <CheckMark />
                No purchase price changes have been reported.
              </div>
            )}
          </div>
        </section>
      )}
      {isAdmin && can("cheques","payment_reports") && (
        <section className="panel dashboard-notifications">
          <div className="notification-heading">
            <div>
              <span className="notification-icon">
                <BellRing />
              </span>
              <div>
                <h2>Cheque reminders</h2>
                <p>
                  Pending and deposited cheques due within {reminderDays}{" "}
                  day(s).
                </p>
              </div>
            </div>
            <Link href="/dashboard/payment-reports/cheques">
              View all cheques
            </Link>
          </div>
          <div className="notification-list">
            {reminders.slice(0, 8).map((row) => {
              const c = Array.isArray(row.centers)
                  ? row.centers[0]
                  : row.centers,
                po = Array.isArray(row.purchase_orders)
                  ? row.purchase_orders[0]
                  : row.purchase_orders,
                supplier = po
                  ? Array.isArray(po.suppliers)
                    ? po.suppliers[0]
                    : po.suppliers
                  : null;
              return (
                <article
                  className={row.diff < 0 ? "overdue" : "upcoming"}
                  key={row.id}
                >
                  {row.diff < 0 ? <TriangleAlert /> : <CalendarClock />}
                  <div>
                    <b>
                      {row.cheque_number} Â· {money.format(Number(row.amount))}
                    </b>
                    <span>
                      {po?.po_number} Â· {supplier?.name ?? "Supplier"} Â·{" "}
                      {c?.code}
                    </span>
                  </div>
                  <strong>
                    {row.diff < 0
                      ? `${Math.abs(row.diff)} day(s) overdue`
                      : row.diff === 0
                        ? "Due today"
                        : `Due in ${row.diff} day(s)`}
                  </strong>
                </article>
              );
            })}
            {!reminders.length && (
              <div className="notification-empty">
                <CheckMark />
                No cheques are due within the reminder period.
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
function CheckMark() {
  return <span aria-hidden="true">âœ“</span>;
}
