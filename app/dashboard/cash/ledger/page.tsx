import Link from "next/link";
import { requirePermission } from "@/lib/access";
import "./cash-ledger.css";

type Params = { center?: string | string[]; from?: string | string[]; to?: string | string[]; page?: string | string[] };
type Center = { id: string; code: string; name: string };
type LedgerRow = {
  entry_id: string;
  posted_at: string;
  description: string;
  source_type: string;
  reference: string;
  debit: number | string;
  credit: number | string;
  running_balance: number | string;
};
const PAGE_SIZE = 50;
const lkr = (n: number) => new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const asText = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
const cleanDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : "";
const dateText = (value: string) => new Intl.DateTimeFormat("en-LK", {
  timeZone: "Asia/Colombo", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

export default async function CashLedgerPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { supabase, profile } = await requirePermission("cash");
  const isSuperAdmin = profile.role === "super_admin";
  const centerParam = asText(params.center);
  const from = cleanDate(asText(params.from));
  const to = cleanDate(asText(params.to));
  const pageValue = Number(asText(params.page));
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 20000) : 1;

  const [{ data: allCenters, error: centerError }, { data: assignments, error: accessError }] = await Promise.all([
    supabase.from("centers").select("id,code,name").eq("organization_id", profile.organization_id).order("code"),
    supabase.from("user_center_access").select("center_id").eq("user_id", profile.id),
  ]);
  if (centerError) throw new Error(`Unable to load centers: ${centerError.message}`);
  if (accessError) throw new Error(`Unable to check center assignments: ${accessError.message}`);

  // Regular Admin is deliberately scoped by explicit center assignment.
  // This is stricter than the legacy 'admin sees all centers' cash RLS policy.
  const allowedIds = new Set((assignments ?? []).map(x => x.center_id));
  const allowedCenters: Center[] = ((allCenters ?? []) as Center[]).filter(c => isSuperAdmin || allowedIds.has(c.id));
  const chosen = centerParam ? allowedCenters.find(c => c.id === centerParam) : allowedCenters[0];
  const invalidSelection = !!centerParam && !chosen;

  const urlFor = (targetPage: number) => {
    const q = new URLSearchParams();
    if (chosen) q.set("center", chosen.id);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (targetPage > 1) q.set("page", String(targetPage));
    return `/dashboard/cash/ledger?${q.toString()}`;
  };

  let rows: LedgerRow[] = [];
  let balance: number | null = null;
  let fetchError = "";
  if (chosen && !(from && to && from > to)) {
    const { data: account, error: accountError } = await supabase.from("cash_accounts")
      .select("id").eq("organization_id", profile.organization_id)
      .eq("kind", "center").eq("center_id", chosen.id).single();
    if (accountError || !account) {
      fetchError = `Center cash account unavailable. ${accountError?.message ?? "Run migration 039."}`;
    } else {
      const [{ data: statement, error: ledgerError }, { data: latestBalance, error: balanceError }] = await Promise.all([
        supabase.rpc("center_cash_general_ledger", {
          p_center: chosen.id,
          p_from: from || null,
          p_to: to || null,
          p_limit: PAGE_SIZE + 1,
          p_offset: (page - 1) * PAGE_SIZE,
        }),
        supabase.rpc("cash_account_balance", { p_account: account.id }),
      ]);
      if (ledgerError) fetchError = `Cash Ledger could not load: ${ledgerError.message}. Confirm migration 042 is applied.`;
      else rows = (statement ?? []) as LedgerRow[];
      if (balanceError) fetchError ||= `Unable to get account balance: ${balanceError.message}`;
      else balance = latestBalance === null ? null : Number(latestBalance);
    }
  }
  const hasNext = rows.length > PAGE_SIZE;
  const displayRows = rows.slice(0, PAGE_SIZE);
  const openingBalance = displayRows.length
    ? Number(displayRows[0].running_balance) - Number(displayRows[0].debit) + Number(displayRows[0].credit)
    : null;
  const lastBalance = displayRows.length ? Number(displayRows.at(-1)?.running_balance) : null;

  return (
    <section className="cash-gl">
      <div className="page-heading"><div>
        <span className="eyebrow dark">CASH/BANK MANAGE</span>
        <h1>Cash Ledger</h1>
        <p>Center cash account statement · Double-entry journal · Amounts in LKR</p>
      </div></div>

      <form className="panel cash-gl-filters" action="/dashboard/cash/ledger" method="get">
        <label>Center cash account
          <select name="center" defaultValue={chosen?.id ?? ""} disabled={!allowedCenters.length}>
            {!allowedCenters.length && <option value="">No assigned center</option>}
            {allowedCenters.map(c => <option value={c.id} key={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </label>
        <label>From date <input type="date" name="from" defaultValue={from} /></label>
        <label>To date <input type="date" name="to" defaultValue={to} /></label>
        <button type="submit" className="primary" disabled={!allowedCenters.length}>View ledger</button>
        <Link className="soft cash-gl-reset" href="/dashboard/cash/ledger">Clear filters</Link>
      </form>

      {!allowedCenters.length && <p className="panel cash-gl-message">No center is assigned to your account. Ask the Super Admin to assign your center in Users & Access. Other centers' cash records will not be shown.</p>}
      {invalidSelection && <p className="alert error">This center cash account is not assigned to your user.</p>}
      {from && to && from > to && <p className="alert error">The From date must be on or before the To date.</p>}
      {fetchError && <p className="alert error">{fetchError}</p>}

      {chosen && !invalidSelection && !(from && to && from > to) && !fetchError && <>
        <div className="cash-gl-summary">
          <article className="panel"><span>Account</span><strong>{chosen.code} · {chosen.name}</strong><small>Center Cash Account</small></article>
          <article className="panel"><span>Current cash balance</span><strong>LKR {balance === null ? "Unavailable" : lkr(balance)}</strong><small>All posted transactions</small></article>
          <article className="panel"><span>Opening balance of this page</span><strong>{openingBalance === null ? "—" : `LKR ${lkr(openingBalance)}`}</strong><small>Includes earlier transactions</small></article>
        </div>
        <section className="panel cash-gl-statement" aria-label="Cash general ledger entries">
          <div className="cash-gl-statement-heading"><div><h2>General Ledger — Center Cash</h2><p>Debit increases cash · Credit reduces cash · Running balance uses all earlier postings</p></div><span>Page {page}</span></div>
          <div className="cash-gl-scroll"><table>
            <thead><tr><th>Date & time</th><th>Description</th><th>Reference</th><th className="number">Debit (LKR)</th><th className="number">Credit (LKR)</th><th className="number">Balance (LKR)</th></tr></thead>
            <tbody>
              {displayRows.length > 0 && <tr className="cash-gl-opening"><td colSpan={5}>Opening balance before displayed transactions</td><td className="number">{openingBalance === null ? "—" : lkr(openingBalance)}</td></tr>}
              {displayRows.map(row => <tr key={row.entry_id}>
                <td className="cash-gl-date">{dateText(row.posted_at)}</td>
                <td><b>{row.description}</b><small>{row.source_type}</small></td>
                <td>{row.reference || "—"}</td>
                <td className="number cash-gl-debit">{Number(row.debit) ? lkr(Number(row.debit)) : "—"}</td>
                <td className="number cash-gl-credit">{Number(row.credit) ? lkr(Number(row.credit)) : "—"}</td>
                <td className="number cash-gl-running">{lkr(Number(row.running_balance))}</td>
              </tr>)}
              {!displayRows.length && <tr><td className="cash-gl-empty" colSpan={6}>No cash ledger entries found for the selected period.</td></tr>}
            </tbody>
            {lastBalance !== null && <tfoot><tr><td colSpan={5}>Closing balance after displayed transactions</td><td className="number">{lkr(lastBalance)}</td></tr></tfoot>}
          </table></div>
        </section>
        <nav className="cash-gl-pages" aria-label="Ledger pages">
          {page > 1 ? <Link className="soft" href={urlFor(page - 1)}>← Previous</Link> : <span />}
          {hasNext ? <Link className="soft" href={urlFor(page + 1)}>Next →</Link> : <span />}
        </nav>
      </>}
    </section>
  );
}
