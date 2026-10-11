"use client";
import { useState } from "react";
import { Bill, getBillDisplayLines, type BillData } from "@/components/bill";
import "@/app/bill-detail.css";

const money = (value: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(value);

export function BillDetail({ data: bill }: { data: BillData }) {
  const [language, setLanguage] = useState<"en" | "si">("en");
  const isPurchase = bill.title.includes("PURCHASE");
  const weighingBill = isPurchase && bill.lines.some(line => Number(line.sacks ?? 0) > 0);
  const displayLines = getBillDisplayLines(bill);
  const cancelled = bill.status === "cancelled";
  return <div className="bill-detail-layout">
    <div className="bill-detail-screen">
      <header className="bill-detail-heading">
        <div><span className="eyebrow dark">{isPurchase ? "PURCHASES" : "SALES"} / BILL DETAILS</span><h1>{bill.number}</h1><p>{isPurchase ? "Purchase bill" : "Customer invoice"} · {bill.date}</p></div>
        <div className="bill-detail-tools"><div className="bill-language" aria-label="Receipt language"><button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button><button type="button" className={language === "si" ? "active" : ""} onClick={() => setLanguage("si")}>සිංහල</button></div><span className={`bill-detail-status ${cancelled ? "cancelled" : bill.credit ? "due" : "paid"}`}>{cancelled ? "Cancelled" : bill.credit ? "Payment due" : "Paid"}</span></div>
      </header>

      <section className="bill-detail-summary" aria-label="Bill totals">
        <div><span>Total amount</span><strong>{money(bill.total)}</strong></div>
        <div><span>Paid amount</span><strong>{money(bill.paid ?? 0)}</strong></div>
        <div><span>Due balance</span><strong>{money(bill.credit ?? 0)}</strong></div>
      </section>

      <div className="bill-detail-columns">
        <section className="bill-detail-panel"><h2>Bill information</h2><dl>
          <dt>Bill number</dt><dd>{bill.number}</dd>
          <dt>Date</dt><dd>{bill.date}</dd>
          <dt>Center</dt><dd>{bill.center}</dd>
          <dt>{isPurchase ? "Supplier" : "Customer"}</dt><dd>{bill.party}</dd>
          {bill.user && <><dt>Created by</dt><dd>{bill.user}</dd></>}
          <dt>Status</dt><dd className="capitalize">{bill.status?.replaceAll("_", " ")}</dd>
        </dl></section>
        <section className="bill-detail-panel"><h2>Payment summary</h2>
          {bill.payments?.length ? <div className="bill-detail-payments">{bill.payments.map((payment, index) => <div key={index}><div><span className="capitalize">{payment.method.replaceAll("_", " ")}</span><strong>{money(payment.amount)}</strong></div>{payment.details && <small>{payment.details}</small>}</div>)}</div> : <p>No payment recorded yet.</p>}
          {bill.credit ? <p className="bill-detail-due">Remaining due: <strong>{money(bill.credit)}</strong></p> : null}
        </section>
      </div>

      <section className="bill-detail-panel bill-detail-items"><h2>Items</h2><div className="bill-detail-table-wrap"><table className={weighingBill?"bill-weight-detail-table":""}><thead>{weighingBill?<tr><th>No</th><th>Item</th><th className="number">Total sacks</th><th className="number">Total weight</th><th className="number">Unit price</th><th className="number">Total amount</th></tr>:<tr><th>Item</th><th>Quality</th><th className="number">Quantity</th>{isPurchase&&<th className="number">Sacks</th>}<th className="number">Unit price</th><th className="number">Amount</th></tr>}</thead><tbody>{displayLines.map((line,index)=><tr key={`${line.name}-${line.quality}-${index}`}>{weighingBill?<><td>{index+1}</td><td><strong>{line.name}</strong>{line.quality&&<small className="bill-detail-quality">{line.quality}</small>}</td><td className="number">{line.sacks??0}</td><td className="number">{line.quantity} {line.unit}</td><td className="number">{money(line.price)}</td><td className="number"><strong>{money(line.total)}</strong></td></>:<><td><strong>{line.name}</strong></td><td>{line.quality||"—"}</td><td className="number">{line.quantity} {line.unit}</td>{isPurchase&&<td className="number">{line.sacks??0}</td>}<td className="number">{money(line.price)}</td><td className="number"><strong>{money(line.total)}</strong></td></>}</tr>)}</tbody><tfoot><tr><td colSpan={weighingBill?5:isPurchase?5:4}>Total</td><td className="number">{money(bill.total)}</td></tr></tfoot></table></div></section>
      {bill.notes && <section className="bill-detail-panel"><h2>Notes</h2><p>{bill.notes}</p></section>}
    </div>
    <div className="bill-detail-print"><Bill data={{ ...bill, language }} /></div>
  </div>;
}
