import Link from "next/link";
import "@/app/purchase-lot-receipts.css";
export type LotReceipt={id:string;lotNumber:string;product:string;quality:string;purchaseId:string;purchaseNumber:string;purchaseStatus:string;location:string;center:string;quantity:number;unit:string;unitPrice:number;receivedAt:string};
export function PurchaseLotReceipts({receipts}:{receipts:LotReceipt[]}){
 return <div className="purchase-lot-receipt-grid">{receipts.map(receipt=><article className="purchase-lot-receipt" key={receipt.id}>
  <header><h3>{receipt.lotNumber}</h3><span>{receipt.purchaseStatus==="cancelled"?"Cancelled purchase":"Receipt"}</span></header>
  <p><b>{receipt.product}</b> · {receipt.quality}</p><dl><div><dt>Original received quantity</dt><dd>{receipt.quantity.toLocaleString("en-LK",{maximumFractionDigits:3})} {receipt.unit}</dd></div>
  <div><dt>Unit purchase price</dt><dd>{receipt.unitPrice.toLocaleString("en-LK",{style:"currency",currency:"LKR"})}</dd></div>
  <div><dt>Center / location</dt><dd>{receipt.center} / {receipt.location}</dd></div><div><dt>Received</dt><dd>{new Date(receipt.receivedAt).toLocaleString("en-GB",{timeZone:"Asia/Colombo"})}</dd></div></dl>
  <Link href={`/dashboard/purchases/${receipt.purchaseId}`}>{receipt.purchaseNumber}</Link>
 </article>)}{!receipts.length&&<p className="panel">No lot receipts match these filters.</p>}</div>;
}
