import { Bill, type BillData } from "@/components/bill";
import "@/app/bill-detail.css";

const money = (value: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR" }).format(value);

export function BillDetail({ data: bill }: { data: BillData }) {
  const isPurchase = bill.title.includes("PURCHASE");
  const cancelled = bill.status === "cancelled";
  return <div className="bill-detail-layout">
    <div className="bill-detail-screen">
      <header className="bill-detail-heading">
        <div><span className="eyebrow dark">{isPurchase ? "PURCHASES" : "SALES"} / BILL DETAILS</span><h1>{bill.number}</h1><p>{isPurchase ? "Purchase bill" : "Customer invoice"} · {bill.date}</p></div>
        <span className={`bill-detail-status ${cancelled ? "cancelled" : bill.credit ? "due" : "paid"}`}>{cancelled ? "Cancelled" : bill.credit ? "Payment due" : "Paid"}</span>
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

      <section className="bill-detail-panel bill-detail-items"><h2>Items</h2><div className="bill-detail-table-wrap"><table><thead><tr><th>Item</th><th>Quality</th><th className="number">Quantity</th><th className="number">Unit price</th><th className="number">Amount</th></tr></thead><tbody>{bill.lines.map((line, index) => <tr key={index}><td><strong>{line.name}</strong></td><td>{line.quality || "—"}</td><td className="number">{line.quantity} {line.unit}</td><td className="number">{money(line.price)}</td><td className="number"><strong>{money(line.total)}</strong></td></tr>)}</tbody><tfoot><tr><td colSpan={4}>Total</td><td className="number">{money(bill.total)}</td></tr></tfoot></table></div></section>
      {bill.notes && <section className="bill-detail-panel"><h2>Notes</h2><p>{bill.notes}</p></section>}
    </div>
    <div className="bill-detail-print"><Bill data={bill} /></div>
  </div>;
}
