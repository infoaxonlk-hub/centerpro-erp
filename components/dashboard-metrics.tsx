import Link from "next/link";
import {ArrowDownToLine,ArrowUpFromLine,Boxes,ClipboardList,PackageSearch,Wallet} from "lucide-react";
import type {DashboardSummary} from "@/lib/dashboard-summary";
import "@/app/dashboard-summary.css";
const number=(value:number)=>value.toLocaleString("en-LK",{maximumFractionDigits:3});
const amount=(value:number)=>value.toLocaleString("en-LK",{minimumFractionDigits:2,maximumFractionDigits:2});
function Money({value}:{value:number}){return <div className="dashboard-money"><small>LKR</small><strong>{amount(value)}</strong></div>;}
export function DashboardMetrics({summary}:{summary:DashboardSummary}){
 return <section className="dashboard-overview-summary" aria-label="Business summary">
  <div className="dashboard-summary-heading"><div><span className="eyebrow dark">AT A GLANCE</span><h2>Business summary</h2></div><span>{summary.day} · Sri Lanka time</span></div>
  <div className="dashboard-summary-grid">
   {summary.todayPurchases!==null&&<article className="dashboard-summary-card purchases"><span className="dashboard-summary-label"><ArrowDownToLine size={18}/> Today&apos;s purchases</span>
    <Money value={summary.todayPurchases}/><small>{summary.todayPurchaseCount} confirmed order{summary.todayPurchaseCount===1?"":"s"} today</small></article>}
   {summary.todaySales!==null&&<article className="dashboard-summary-card sales"><span className="dashboard-summary-label"><ArrowUpFromLine size={18}/> Today&apos;s sales</span>
    <Money value={summary.todaySales}/><small>{summary.todaySaleCount} confirmed sale{summary.todaySaleCount===1?"":"s"} today</small></article>}
   {summary.centerCash!==null&&<article className="dashboard-summary-card cash"><span className="dashboard-summary-label"><Wallet size={18}/> Center available cash</span>
    <Money value={summary.centerCash.total}/><small>{summary.centerCash.centers.length} permitted center{summary.centerCash.centers.length===1?"":"s"}</small>
    {summary.centerCash.centers.length>0&&<details className="dashboard-center-balances"><summary>By center</summary><ul>{summary.centerCash.centers.map(center=><li key={center.id}><span>{center.name}</span><b>LKR {amount(center.balance)}</b></li>)}</ul></details>}</article>}
   {summary.purchaseOrderCount!==null&&<article className="dashboard-summary-card orders"><span className="dashboard-summary-label"><ClipboardList size={18}/> Purchase order count</span>
    <strong>{number(summary.purchaseOrderCount)}</strong><small>Confirmed orders, all time</small></article>}
   {summary.stock!==null&&<article className="dashboard-summary-card stock"><span className="dashboard-summary-label"><Boxes size={18}/> Total stock</span>
    {summary.stock.length?summary.stock.map(item=><strong key={item.unit}>{number(item.quantity)} <span className="dashboard-unit">{item.unit}</span></strong>):<strong>0</strong>}
    <small>Current balance across permitted centers</small></article>}
   {summary.highestStock!==null&&<article className="dashboard-summary-card highest"><span className="dashboard-summary-label"><PackageSearch size={18}/> {summary.highestStock.length>1?"Highest stock by unit":"Highest stock product"}</span>
    {summary.highestStock.length?summary.highestStock.map(product=><div className="dashboard-top-product" key={product.unit}><Link href={"/dashboard/stock?product="+encodeURIComponent(product.productId)}>{product.product}</Link><strong>{number(product.quantity)} <span className="dashboard-unit">{product.unit}</span></strong></div>):<strong>No positive stock</strong>}
    <small>Product quantity across permitted locations</small></article>}
  </div>
 </section>;
}
