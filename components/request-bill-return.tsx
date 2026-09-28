"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notify } from "@/components/feedback";

export type ReturnSourceLine = { id: string; name: string; quality: string; unit: string; quantity: number; available: number; unitPrice: number };

export function RequestBillReturn({ type, billId, billNumber, lines }: { type: "sale" | "purchase"; billId: string; billNumber: string; lines: ReturnSourceLine[] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const chosen = lines.map(line => ({ line_id: line.id, quantity: Number(quantities[line.id] ?? 0) })).filter(line => line.quantity > 0);
  const total = chosen.reduce((sum, line) => sum + line.quantity * (lines.find(item => item.id === line.line_id)?.unitPrice ?? 0), 0);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen.length) return notify("Enter a return quantity for at least one item", "error");
    setBusy(true);
    const { error } = await createClient().rpc("request_bill_return", { p_type: type, p_bill: billId, p_reason: reason, p_lines: chosen });
    setBusy(false);
    if (error) return notify(error.message, "error");
    notify("Return request sent to administrator");
    window.location.reload();
  }

  if (!lines.some(line => line.available > 0)) return null;
  return <>
    <button type="button" className="ghost" onClick={() => setOpen(true)}>Request return</button>
    {open && <div className="dialog-backdrop"><form className="dialog return-request-dialog" onSubmit={submit}>
      <div className="dialog-head"><div><h2>Request {type === "sale" ? "sales" : "purchase"} return</h2><p>{billNumber} · An administrator will review the items and quantities.</p></div><button type="button" className="icon-btn" onClick={() => setOpen(false)}>×</button></div>
      <div className="return-request-lines"><div className="return-request-head"><span>Item</span><span>Available</span><span>Return qty</span></div>{lines.map(line => <label className="return-request-line" key={line.id}>
        <span><strong>{line.name}</strong><small>{line.quality} · {line.unit}</small></span><span>{line.available} {line.unit}</span>
        <input aria-label={`Return quantity for ${line.name}`} type="number" min="0" max={line.available} step="0.001" value={quantities[line.id] ?? ""} disabled={line.available <= 0} onChange={event => setQuantities(current => ({ ...current, [line.id]: event.target.value }))} />
      </label>)}</div>
      <p className="return-request-total">Estimated credit note: <strong>{new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(total)}</strong></p>
      <label>Reason<textarea required minLength={4} value={reason} onChange={event => setReason(event.target.value)} placeholder="For example: damaged goods" /></label>
      <p className="form-help">Approved returns add sale items back to stock or remove purchase items from stock. The bill due is reduced first; any remaining value is recorded as an unapplied credit note.</p>
      <div className="dialog-actions"><button type="button" className="ghost" onClick={() => setOpen(false)}>Back</button><button className="primary" disabled={busy || chosen.length === 0}>{busy ? "Sending…" : "Send return request"}</button></div>
    </form></div>}
  </>;
}
