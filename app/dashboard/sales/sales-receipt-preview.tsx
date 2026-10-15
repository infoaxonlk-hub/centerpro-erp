"use client";

import Link from "next/link";
import { useState } from "react";
import { Bill, type BillData } from "@/components/bill";
import { CancelBill } from "@/components/cancel-bill";
import { RequestBillReturn, type ReturnSourceLine } from "@/components/request-bill-return";
import "./sales-receipt-preview.css";

type Props = {
  id: string;
  bill: BillData;
  canRequestReturn: boolean;
  returnLines: ReturnSourceLine[];
};

const money = (value: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(value);

export function SalesReceiptPreview({ id, bill, canRequestReturn, returnLines }: Props) {
  const [language, setLanguage] = useState<"en" | "si">("en");
  const cancelled = bill.status === "cancelled";
  const due = Number(bill.credit ?? 0);
  const statusText = cancelled ? "Cancelled" : due > 0 ? "Credit balance" : "Paid";

  return <section className="sales-receipt-view" aria-label="Sales POS receipt preview">
    <header className="sales-receipt-heading">
      <div>
        <span className="sales-receipt-eyebrow">SALES / POS RECEIPT</span>
        <h1>Receipt preview</h1>
        <p>Sale <strong>{bill.number}</strong> · {bill.date}</p>
      </div>
      <span className={`sales-receipt-status ${cancelled ? "cancelled" : due > 0 ? "due" : "paid"}`}>{statusText}</span>
    </header>

    <nav className="bill-actions sales-receipt-actions" aria-label="Sales receipt actions">
      <button type="button" className="primary" onClick={() => window.print()}>Print receipt</button>
      <Link className="ghost sales-receipt-new" href="/dashboard/sales/new">+ New sale</Link>
      {canRequestReturn && <RequestBillReturn type="sale" billId={id} billNumber={bill.number ?? ""} lines={returnLines} />}
      <CancelBill type="sale" id={id} disabled={cancelled} />
    </nav>

    {due > 0 && !cancelled && <p className="sales-receipt-credit-note" role="status">
      Outstanding customer credit: <strong>{money(due)}</strong>
      <Link href="/dashboard/sales/receivables">Record payment</Link>
    </p>}

    <div className="sales-receipt-paper-area">
      <div className="sales-receipt-paper-toolbar">
        <span>80mm POS receipt · Preview only</span>
        <div className="bill-language" aria-label="Receipt language">
          <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
          <button type="button" className={language === "si" ? "active" : ""} aria-pressed={language === "si"} onClick={() => setLanguage("si")}>සිංහල</button>
        </div>
      </div>
      <Bill data={{ ...bill, language }} />
    </div>
  </section>;
}
