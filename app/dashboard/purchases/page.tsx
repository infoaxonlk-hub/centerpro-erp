import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";

const PAGE_SIZE = 25;
const methods = ["cash", "credit", "bank_transfer", "card", "cheque"] as const;
const statuses = ["confirmed", "cancelled"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const value = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] ?? "" : v ?? "";
const one = <T,>(v: T | T[] | null) => Array.isArray(v) ? v[0] : v;
const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" });

export default async function PurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ supabase: s }, params] = await Promise.all([requirePermission("purchases"), searchParams]);
  const q = value(params.q).trim();
  const center = value(params.center);
  const supplier = value(params.supplier);
  const status = value(params.status);
  const method = value(params.method);
  const from = value(params.from);
  const to = value(params.to);
  const requestedPage = Math.max(1, Number.parseInt(value(params.page) || "1", 10) || 1);

  const [{ data: centers }, { data: suppliers }] = await Promise.all([
    s.from("centers").select("id,code,name").order("code"),
    s.from("suppliers").select("id,name").order("name"),
  ]);

  let query = s.from("purchase_orders")
    .select("id,po_number,status,payment_method,total_amount,created_at,center_id,supplier_id,centers(name,code),suppliers(name)", { count: "exact" })
    .order("created_at", { ascending: false });

  if (q) query = query.ilike("po_number", `%${q}%`);
  if (center) query = query.eq("center_id", center);
  if (supplier === "cash") query = query.is("supplier_id", null);
  else if (supplier) query = query.eq("supplier_id", supplier);
  if ((statuses as readonly string[]).includes(status)) query = query.eq("status", status);
  if ((methods as readonly string[]).includes(method)) query = query.eq("payment_method", method);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999+05:30`);

  const { data: rows, count, error } = await query.range((requestedPage - 1) * PAGE_SIZE, requestedPage * PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load purchase orders: ${error.message}`);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const queryString = (nextPage: number) => {
    const next = new URLSearchParams();
    for (const [key, val] of Object.entries({ q, center, supplier, status, method, from, to })) if (val) next.set(key, val);
    next.set("page", String(nextPage));
    return `?${next.toString()}`;
  };
  if (requestedPage > totalPages) redirect(queryString(totalPages));

  return <>
    <div className="page-heading">
      <div><span className="eyebrow dark">PROCUREMENT</span><h1>Purchases</h1><p>Open a PO number to view or print its bill and request cancellation.</p></div>
      <Link className="primary" href="/dashboard/purchases/new">New purchase</Link>
    </div>
    <form className="panel purchase-list-filters" method="get">
      <label className="purchase-list-search">Search PO number<input name="q" defaultValue={q} placeholder="e.g. PO-20260924-0103" /></label>
      <label>Center<select name="center" defaultValue={center}><option value="">All centers</option>{(centers ?? []).map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
      <label>Supplier<select name="supplier" defaultValue={supplier}><option value="">All suppliers</option><option value="cash">Cash purchase</option>{(suppliers ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Payment<select name="method" defaultValue={method}><option value="">All methods</option>{methods.map(x => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}</select></label>
      <label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{statuses.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>From<input type="date" name="from" defaultValue={from} /></label>
      <label>To<input type="date" name="to" defaultValue={to} /></label>
      <div className="purchase-filter-actions"><button className="primary" type="submit">Apply filters</button><Link className="ghost" href="/dashboard/purchases">Clear</Link></div>
    </form>
    <section className="panel table-panel purchase-list-table">
      <div className="purchase-list-summary">{total === 0 ? "No purchase orders found" : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} purchase orders`}</div>
      <table><thead><tr><th>PO</th><th>Center</th><th>Supplier</th><th>Date</th><th>Payment</th><th>Status</th><th className="number">Total</th></tr></thead>
        <tbody>{(rows ?? []).map(r => {
          const c = one(r.centers);
          const supplierRow = one(r.suppliers);
          return <tr key={r.id}>
            <td><Link href={`/dashboard/purchases/${r.id}`}><strong>{r.po_number}</strong></Link></td>
            <td>{c?.code} · {c?.name}</td><td>{supplierRow?.name ?? "Cash purchase"}</td>
            <td>{new Date(r.created_at).toLocaleString("en-LK", { timeZone: "Asia/Colombo" })}</td>
            <td className="capitalize">{r.payment_method.replaceAll("_", " ")}</td>
            <td><span className={`status ${r.status === "confirmed" ? "active" : "inactive"}`}>{r.status}</span></td>
            <td className="number">{money.format(Number(r.total_amount))}</td>
          </tr>;
        })}{!rows?.length && <tr><td colSpan={7} className="table-empty">No purchase orders match these filters.</td></tr>}</tbody>
      </table>
      {totalPages > 1 && <nav className="purchase-list-pagination" aria-label="Purchase order pages">
        <Link aria-disabled={page <= 1} className={page <= 1 ? "disabled" : ""} href={queryString(Math.max(1, page - 1))}>Previous</Link>
        <span>Page {page} of {totalPages}</span>
        <Link aria-disabled={page >= totalPages} className={page >= totalPages ? "disabled" : ""} href={queryString(Math.min(totalPages, page + 1))}>Next</Link>
      </nav>}
    </section>
  </>;
}
