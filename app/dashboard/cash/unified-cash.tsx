"use client";

import { useState } from "react";
import { Banknote, CheckCircle2, Landmark, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notify } from "@/components/feedback";
import "./unified-cash.css";

type Center = { id: string; code: string; name: string };
type Account = { id: string; kind: string; center_id: string | null; name: string; balance: number | null };
type Issue = {
  id: string;
  center_id: string;
  reference: string;
  purchase_issued: number;
  expense_issued: number;
  purchase_received: number | null;
  expense_received: number | null;
  status: string;
  receipt_note: string | null;
  issued_at: string;
  received_at: string | null;
  centers: Center | Center[] | null;
};

type Props = {
  isAdmin: boolean;
  centers: Center[];
  accounts: Account[];
  issues: Issue[];
};

const currency = (value: number) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(value);
const one = <T,>(item: T | T[] | null): T | null => Array.isArray(item) ? item[0] ?? null : item;

export function UnifiedCash({ isAdmin, centers, accounts, issues }: Props) {
  const [mode, setMode] = useState<"issue" | "in">("issue");
  const [busy, setBusy] = useState(false);
  const [purchase, setPurchase] = useState("");
  const [expense, setExpense] = useState("");
  const main = accounts.find((account) => account.kind === "admin_main");
  const centerAccounts = accounts.filter((account) => account.kind === "center");
  const available = Number(main?.balance ?? 0);
  const pending = issues.filter((item) => item.status === "pending");
  const total = Number(purchase || 0) + Number(expense || 0);
  const centerName = (id: string) => {
    const center = centers.find((item) => item.id === id);
    return center ? `${center.code} · ${center.name}` : "Center";
  };

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, message: string) => {
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) throw error;
      notify(message, "success");
      window.location.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const addCash = (form: FormData) => run(() => createClient().rpc("record_admin_cash_in", {
    p_amount: Number(form.get("amount")),
    p_source: String(form.get("source")),
    p_details: String(form.get("details")),
  }), "Cash added to Admin Main Cash");

  const issueCash = (form: FormData) => run(() => createClient().rpc("issue_combined_center_cash", {
    p_center: String(form.get("center")),
    p_purchase: Number(form.get("purchase") || 0),
    p_expense: Number(form.get("expense") || 0),
    p_reference: String(form.get("reference")),
  }), "Cash issued; waiting for center receipt");

  const confirmReceipt = (id: string, form: FormData) => run(() => createClient().rpc("receive_center_cash_with_note", {
    p_issue: id,
    p_purchase: Number(form.get("purchase")),
    p_expense: Number(form.get("expense")),
    p_note: String(form.get("note") ?? ""),
  }), "Cash receipt confirmed");

  return (
    <section className="unified-cash">
      <header className="page-heading">
        <div>
          <span className="eyebrow dark">CASH / BANK MANAGE</span>
          <h1>Cash Management</h1>
          <p>{isAdmin
            ? "View cash balances, add funds to Admin Main Cash and issue cash to a center."
            : "View your center cash balance and confirm money received from Admin."}</p>
        </div>
      </header>

      <section className="cash-management-balances" aria-label="Cash account balances">
        <div className="cash-management-section-heading">
          <h2>Cash balances</h2>
          <p>{isAdmin ? "Admin and center cash accounts" : "Your assigned center cash accounts"}</p>
        </div>
        <div className="cash-account-cards">
          {isAdmin && (
            <article className="cash-account-card cash-account-main">
              <span><Landmark size={18} /> Admin Main Cash</span>
              <strong>{main?.balance == null ? "Unavailable" : currency(available)}</strong>
              <small>Available to issue to centers</small>
            </article>
          )}
          {centerAccounts.map((account) => (
            <article className="cash-account-card" key={account.id}>
              <span><Wallet size={18} /> {centerName(account.center_id ?? "")}</span>
              <strong>{account.balance == null ? "Unavailable" : currency(Number(account.balance))}</strong>
              <small>Center cash balance</small>
            </article>
          ))}
          {!centerAccounts.length && (
            <article className="cash-account-card">
              <span>No center cash account assigned</span>
              <small>Ask the administrator to assign an active center.</small>
            </article>
          )}
        </div>
      </section>

      {isAdmin && (
        <section className="panel cash-management-actions" aria-label="Cash actions">
          <div className="cash-action-tabs" role="group" aria-label="Cash action">
            <button type="button" className={mode === "issue" ? "primary" : "ghost"}
              aria-pressed={mode === "issue"} onClick={() => setMode("issue")}>Issue to center</button>
            <button type="button" className={mode === "in" ? "primary" : "ghost"}
              aria-pressed={mode === "in"} onClick={() => setMode("in")}>Add Cash In</button>
          </div>
          {mode === "in" ? (
            <form className="cash-action-form" action={addCash}>
              <h2>Add cash to Admin Main</h2>
              <label>Amount (LKR)
                <input type="number" name="amount" min="0.01" step="0.01" required />
              </label>
              <label>Source
                <select name="source" required>
                  <option value="owner_cash">Owner / business funding</option>
                  <option value="bank_withdrawal">Bank withdrawal</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="wide">Source details / reference
                <input name="details" required placeholder="e.g. Opening cash / funding reference" />
              </label>
              <p className="wide cash-help">Bank withdrawal is a reference only; the bank account balance is not automatically updated.</p>
              <button className="primary wide" disabled={busy}>{busy ? "Saving…" : "Record Cash In"}</button>
            </form>
          ) : (
            <form className="cash-action-form" action={issueCash}>
              <h2>Issue cash to a center</h2>
              <label>Destination center
                <select name="center" required defaultValue="">
                  <option value="" disabled>Select center</option>
                  {centers.map((center) => (
                    <option key={center.id} value={center.id}>{center.code} · {center.name}</option>
                  ))}
                </select>
              </label>
              <label>Reference
                <input name="reference" required placeholder="e.g. CASH-2026-001" />
              </label>
              <label>For purchases (LKR)
                <input name="purchase" type="number" min="0" step="0.01"
                  value={purchase} onChange={(event) => setPurchase(event.target.value)} />
              </label>
              <label>For expenses (LKR)
                <input name="expense" type="number" min="0" step="0.01"
                  value={expense} onChange={(event) => setExpense(event.target.value)} />
              </label>
              <div className="cash-total wide"><span>Total cash issue</span><strong>{currency(total)}</strong></div>
              <p className="wide cash-help">Both amounts are issued to the same center cash account. Center receipt confirmation is required.</p>
              <button className="primary wide" disabled={busy || !Number.isFinite(total) || total <= 0 || total > available}>
                {busy ? "Issuing…" : "Issue cash"}
              </button>
            </form>
          )}
        </section>
      )}

      {(pending.length > 0 || !isAdmin) && (
        <section className="panel cash-management-receipts" aria-label="Pending cash receipts">
          <div className="cash-section-heading">
            <div>
              <h2>Cash to receive</h2>
              <p>Confirm the actual amount received at the center.</p>
            </div>
            <strong>{pending.length} pending</strong>
          </div>
          {pending.length ? (
            <div className="cash-receive-grid">
              {pending.map((item) => (
                <ReceiveCard key={item.id} issue={item} busy={busy} receive={confirmReceipt} />
              ))}
            </div>
          ) : <p className="cash-help">No pending cash receipts.</p>}
        </section>
      )}
    </section>
  );
}

function ReceiveCard({ issue, busy, receive }: {
  issue: Issue;
  busy: boolean;
  receive: (id: string, form: FormData) => Promise<void>;
}) {
  const [purchase, setPurchase] = useState(String(issue.purchase_issued));
  const [expense, setExpense] = useState(String(issue.expense_issued));
  const actual = Number(purchase || 0) + Number(expense || 0);
  const mismatch = Number(purchase) !== Number(issue.purchase_issued) || Number(expense) !== Number(issue.expense_issued);
  const center = one(issue.centers);

  return (
    <form className="cash-receive-card" action={(form) => receive(issue.id, form)}>
      <h3><Banknote size={17} /> {center?.code} · {center?.name}</h3>
      <small>{issue.reference} · Issued {new Date(issue.issued_at).toLocaleString("en-LK")}</small>
      <div className="cash-receive-amounts">
        <div>Purchase issued<strong>{currency(Number(issue.purchase_issued))}</strong></div>
        <div>Expense issued<strong>{currency(Number(issue.expense_issued))}</strong></div>
        <label>Purchase received
          <input name="purchase" required type="number" min="0" step="0.01"
            value={purchase} onChange={(event) => setPurchase(event.target.value)} />
        </label>
        <label>Expense received
          <input name="expense" required type="number" min="0" step="0.01"
            value={expense} onChange={(event) => setExpense(event.target.value)} />
        </label>
      </div>
      <div className="cash-total"><span>Actual received</span><strong>{currency(actual)}</strong></div>
      {mismatch && (
        <>
          <p className="cash-generic-warning" role="alert">The received amount differs from the issue. Provide a reason.</p>
          <label>Reason for difference
            <input name="note" required maxLength={400} placeholder="Explain the difference" />
          </label>
        </>
      )}
      <button className="primary" disabled={busy || !Number.isFinite(actual)}>
        <CheckCircle2 size={16} /> {busy ? "Saving…" : "Confirm receipt"}
      </button>
    </form>
  );
}
