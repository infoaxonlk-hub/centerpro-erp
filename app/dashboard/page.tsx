import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/access";

const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 });

export default async function DashboardPage() {
  const {supabase} = await requirePermission("dashboard");
  const [{ count: centers }, { count: purchases }, { data: stock }, { data: cash }] = await Promise.all([
    supabase.from("centers").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    supabase.from("stock_movements").select("quantity,movement_type"),
    supabase.from("cash_ledger").select("amount,movement_type"),
  ]);
  const stockQty = (stock ?? []).reduce((sum, row) => sum + (["purchase_in","transfer_in","adjustment_in"].includes(row.movement_type) ? Number(row.quantity) : -Number(row.quantity)), 0);
  const cashBalance = (cash ?? []).reduce((sum, row) => sum + (["allocation","refund"].includes(row.movement_type) ? Number(row.amount) : -Number(row.amount)), 0);
  return <>
    <div className="page-heading"><div><span className="eyebrow dark">OPERATIONS</span><h1>Business overview</h1><p>Live purchasing and inventory position across permitted centers.</p></div><Link className="primary" href="/dashboard/centers">Manage centers</Link></div>
    <section className="metric-grid">
      <article className="metric accent"><span>Active centers</span><strong>{centers ?? 0}</strong><small>Configured locations included</small></article>
      <article className="metric"><span>Confirmed purchases</span><strong>{purchases ?? 0}</strong><small>All recorded purchase orders</small></article>
      <article className="metric"><span>Stock quantity</span><strong>{stockQty.toLocaleString("en-LK", { maximumFractionDigits: 3 })} kg</strong><small>Movement-ledger balance</small></article>
      <article className="metric"><span>Available center cash</span><strong>{money.format(cashBalance)}</strong><small>Allocations less cash purchases</small></article>
    </section>
    <section className="panel empty-state"><div className="empty-icon">SC</div><h2>Production workspace ready</h2><p>Create centers and locations, then configure products, qualities, prices and suppliers before entering the first purchase.</p></section>
  </>;
}
