import Link from "next/link";
import {redirect} from "next/navigation";
import "@/app/report-date-ranges.css";
import {dateRange} from "@/lib/report-dates";
import {ArrowLeftRight,Boxes} from "lucide-react";
import {requirePermission} from "@/lib/access";
import {StockScrapForm,type ScrapBalance,type ScrapCenter} from "./scrap-form";
import "../stock-chart.css";

const money=new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"});

export default async function StockScrapPage({searchParams}:{searchParams:Promise<{from?:string;to?:string}>}){
 const {supabase:s,profile}=await requirePermission("dashboard","inventory");
 const canScrap=profile.role==="center_user"||profile.role==="super_admin"||(profile.role==="admin"&&profile.permissions.includes("stock"));
 if(!canScrap)redirect("/dashboard?error=Access denied");
 const {from,to,start,end}=dateRange(await searchParams);
 let historyQuery=s.from("stock_scraps").select("id,scrap_number,center_label,location_label,reason,total_quantity,total_value,created_at,stock_scrap_lines(product_code,product_name,quality_name,unit,quantity,unit_cost,line_value)").order("created_at",{ascending:false});
 if(start)historyQuery=historyQuery.gte("created_at",start);if(end)historyQuery=historyQuery.lt("created_at",end);
 const [{data:centerRows,error:centerError},{data:scrapRows,error:scrapError}]=await Promise.all([
  s.from("centers").select("id,code,name,locations(id,code,name,is_active)").eq("is_active",true).order("name"),
  historyQuery.limit(100),
 ]);
 if(centerError)throw new Error("Centers could not be loaded: "+centerError.message);
 if(scrapError)throw new Error("Scrap history could not be loaded: "+scrapError.message);
 const centers=(centerRows??[]).map(c=>({id:c.id,code:c.code,name:c.name,locations:(c.locations??[]).filter(l=>l.is_active).map(l=>({id:l.id,code:l.code,name:l.name}))})).filter(c=>c.locations.length>0) as ScrapCenter[];
 const {data:snapshot,error:balanceError}=await s.rpc("stock_scrap_balances");
 if(balanceError)throw new Error("Stock scrap balances could not be loaded.");
 const balances=(snapshot??[]) as ScrapBalance[];
 return <>
  <div className="page-heading"><div><span className="eyebrow dark">INVENTORY CONTROL</span><h1>Scrap stock</h1><p>Record damaged, expired or unusable stock and remove it from the available inventory.</p></div><div className="stock-scrap-heading-actions"><Link className="ghost" href="/dashboard/stock"><Boxes size={16}/> Stock explorer</Link><Link className="ghost" href="/dashboard/stock/transfers"><ArrowLeftRight size={16}/> Transfers</Link></div></div>
  <StockScrapForm centers={centers} balances={balances}/>
  <form className="panel report-date-form" method="get"><label>From<input type="date" name="from" defaultValue={from}/></label><label>To<input type="date" name="to" defaultValue={to}/></label><button className="primary">Apply dates</button><Link className="ghost" href="/dashboard/stock/scrap">Clear</Link></form>
  <section className="panel table-panel stock-scrap-history"><div className="stock-transfer-history-heading"><div><span className="eyebrow dark">SCRAP RECORDS</span><h2>Recent stock scrap</h2></div><span>{scrapRows?.length??0} shown</span></div>
   <table><thead><tr><th>Scrap no.</th><th>Center / location</th><th>Item(s)</th><th>Reason</th><th className="number">Quantity</th><th className="number">Stock value</th><th>Date</th></tr></thead><tbody>{(scrapRows??[]).map(scrap=><tr key={scrap.id}><td><strong>{scrap.scrap_number}</strong></td><td>{scrap.center_label}<small>{scrap.location_label}</small></td><td>{scrap.stock_scrap_lines.map(line=>`${line.product_code} Â· ${line.product_name} Â· ${line.quality_name} (${Number(line.quantity).toLocaleString("en-LK",{maximumFractionDigits:3})} ${line.unit})`).join(", ")}</td><td>{scrap.reason}</td><td className="number">{Number(scrap.total_quantity).toLocaleString("en-LK",{maximumFractionDigits:3})}</td><td className="number">{money.format(Number(scrap.total_value))}</td><td>{new Date(scrap.created_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"})}</td></tr>)}{!scrapRows?.length&&<tr><td colSpan={7} className="table-empty">No stock scrap records yet.</td></tr>}</tbody></table>
  </section>
 </>;
}
