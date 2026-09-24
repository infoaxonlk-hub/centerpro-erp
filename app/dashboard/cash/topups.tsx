"use client";

import { useState } from "react";
import { ArrowDownToLine, Banknote, CircleHelp, Clock3, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notify } from "@/components/feedback";

type Center = { id: string; code: string; name: string };
type Topup = { id: string; center_id: string; amount: number | string; reference: string; notes: string | null; status: string; created_at: string };

const money = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" });

export function CashTopups({ centers, rows, isAdmin }: { centers: Center[]; rows: Topup[]; isAdmin: boolean }) {
  const [busy, setBusy] = useState(false);

  async function request(fd: FormData) {
    setBusy(true);
    const { error } = await createClient().rpc("request_center_cash_topup", {
      p_center: String(fd.get("center")),
      p_amount: Number(fd.get("amount")),
      p_reference: String(fd.get("reference")),
      p_notes: String(fd.get("note") ?? ""),
    });
    setBusy(false);
    if (error) return notify(error.message, "error");
    notify("Cash added and administrator notified");
    window.location.reload();
  }

  async function review(id: string, approve: boolean) {
    setBusy(true);
    const { error } = await createClient().rpc("review_center_cash_topup", { p_topup: id, p_approve: approve });
    setBusy(false);
    if (error) return notify(error.message, "error");
    notify("Top-up reviewed");
    window.location.reload();
  }

  return (
    <section className="panel cash-topups-panel">
      <div className="cash-topups-heading">
        <span className="cash-topups-icon"><Banknote size={21} /></span>
        <div>
          <span className="eyebrow dark">CASH MANAGEMENT</span>
          <h2>{isAdmin ? "Center cash top-ups" : "Add cash to center"}</h2>
          <p>{isAdmin ? "Review cash entries submitted by center staff." : "Record cash received for your center, such as an owner deposit or opening cash."}</p>
        </div>
      </div>

      {!isAdmin && (
        <form action={request} className="cash-topup-form">
          <label>
            <span>Center</span>
            <select name="center" required defaultValue={centers[0]?.id ?? ""} disabled={centers.length === 0}>
              {centers.map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
            </select>
          </label>
          <label>
            <span>Amount <small>(LKR)</small></span>
            <input name="amount" type="number" min="0.01" step="0.01" placeholder="e.g. 10,000.00" required />
          </label>
          <label>
            <span>Source or reference</span>
            <input name="reference" placeholder="e.g. Owner deposit" required />
          </label>
          <label>
            <span>Note <small>(optional)</small></span>
            <input name="note" placeholder="Add a short note" />
          </label>
          <div className="cash-topup-form-footer">
            <p><CircleHelp size={15} /> The cash balance updates immediately and an administrator is notified.</p>
            <button className="primary" disabled={busy || centers.length === 0}>
              <Plus size={17} />{busy ? "Adding cash…" : "Add cash"}
            </button>
          </div>
        </form>
      )}

      {isAdmin && <div className="cash-topups-admin-note"><ArrowDownToLine size={17} /> New entries from center staff appear below.</div>}

      <div className="table-panel cash-topups-table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Center</th><th>Source / reference</th><th>Amount</th><th>Status</th>{isAdmin && <th>Review</th>}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><span className="cash-topup-date"><Clock3 size={14} />{new Date(row.created_at).toLocaleString("en-LK")}</span></td>
                <td>{centers.find((center) => center.id === row.center_id)?.name ?? "—"}</td>
                <td>{row.reference}{row.notes && <small className="cash-topup-note">{row.notes}</small>}</td>
                <td className="cash-topup-amount">{money.format(Number(row.amount))}</td>
                <td><span className={`cash-topup-status ${row.status.toLowerCase()}`}>{row.status}</span></td>
                {isAdmin && <td>{row.status === "pending" ? <div className="cash-topup-review"><button className="soft" disabled={busy} onClick={() => review(row.id, true)}>Approve</button><button className="ghost" disabled={busy} onClick={() => review(row.id, false)}>Reject</button></div> : "—"}</td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={isAdmin ? 6 : 5} className="table-empty">{isAdmin ? "No center cash top-ups to review." : "No cash entries yet. Add the first entry using the form above."}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
