import {readStockSacks} from "@/lib/stock-sacks";
import Link from "next/link";
import "@/app/report-date-ranges.css";
import {dateRange} from "@/lib/report-dates";
import {Boxes} from "lucide-react";
import {requirePermission} from "@/lib/access";
import {StockTransferForm,type TransferBalance,type TransferCenter} from "./transfer-form";
import "../stock-chart.css";

type Rel<T>=T|T[]|null;
const one=<T,>(value:Rel<T>)=>Array.isArray(value)?value[0]??null:value;
const money=new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"});

export default async function StockTransfersPage({searchParams}:{searchParams:Promise<{from?:string;to?:string}>}){
 const {supabase:s,profile}=await requirePermission("stock");
 const {from,to,start,end}=dateRange(await searchParams);
 let historyQuery=s.from("stock_transfers").select("id,transfer_number,from_label,to_label,note,total_quantity,total_value,created_at,stock_transfer_lines(product_name,quality_name,unit,quantity,unit_cost,line_value)").order("created_at",{ascending:false});
 if(start)historyQuery=historyQuery.gte("created_at",start);if(end)historyQuery=historyQuery.lt("created_at",end);
 const [{data:centerRows,error:centerError},{data:transferRows,error:transferError}]=await Promise.all([
  s.from("centers").select("id,code,name,locations(id,code,name,is_active)").eq("is_active",true).order("name"),
  historyQuery.limit(100),
 ]);
 if(centerError)throw new Error("Centers could not be loaded: "+centerError.message);
 if(transferError)throw new Error("Transfer history could not be loaded: "+transferError.message);
 const centers=(centerRows??[]).map(c=>({id:c.id,code:c.code,name:c.name,locations:(c.locations??[]).filter(l=>l.is_active).map(l=>({id:l.id,code:l.code,name:l.name}))})).filter(c=>c.locations.length>0) as TransferCenter[];
 const rows:Awaited<ReturnType<typeof loadMoves>>["data"] extends (infer R)[]|null?R[]:never=[];
 function loadMoves(){return s.from("stock_movements").select("id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,inventory_value,centers(name,code),locations(name,code),products(name,code,unit_of_measure,tracks_sacks),product_qualities(name)").order("created_at").order("id")}
 for(let offset=0;;offset+=500){const {data,error}=await loadMoves().range(offset,offset+499);if(error)throw new Error("Stock balances could not be loaded: "+error.message);rows.push(...data);if(data.length<500)break}
 const grouped=new Map<string,TransferBalance>();
 for(const row of rows){
  const center=one(row.centers),location=one(row.locations),product=one(row.products),quality=one(row.product_qualities);
  const key=[row.center_id,row.location_id,row.product_id,row.quality_id].join(":");
  const balance=grouped.get(key)??{key,centerId:row.center_id,locationId:row.location_id,productId:row.product_id,qualityId:row.quality_id,centerLabel:`${center?.code??""} · ${center?.name??""}`,locationLabel:`${location?.code??""} · ${location?.name??""}`,productCode:product?.code??"",productName:product?.name??"",qualityName:quality?.name??"",unit:product?.unit_of_measure??"unit",quantity:0,value:0,tracksSacks:product?.tracks_sacks};
  const sign=["purchase_in","transfer_in","adjustment_in"].includes(row.movement_type)?1:-1;
  balance.quantity+=sign*Number(row.quantity);balance.value+=sign*Number(row.inventory_value);grouped.set(key,balance);
 }
 const sacks=await readStockSacks(s,profile.organization_id);
 for(const [key,row] of grouped){row.sacks=sacks.get(key);}
 const balances=[...grouped.values()].filter(x=>x.quantity>0.0001).sort((a,b)=>a.productName.localeCompare(b.productName)||a.qualityName.localeCompare(b.qualityName));
 return <>
  <div className="page-heading"><div><span className="eyebrow dark">INVENTORY</span><h1>Internal stock transfers</h1><p>Move stock between accessible centers or between locations inside a center.</p></div><Link className="ghost" href="/dashboard/stock"><Boxes size={16}/> Stock explorer</Link></div>
  <StockTransferForm centers={centers} balances={balances}/>
  <form className="panel report-date-form" method="get"><label>From<input type="date" name="from" defaultValue={from}/></label><label>To<input type="date" name="to" defaultValue={to}/></label><button className="primary">Apply dates</button><Link className="ghost" href="/dashboard/stock/transfers">Clear</Link></form>
  <section className="panel table-panel stock-transfer-history"><div className="stock-transfer-history-heading"><div><span className="eyebrow dark">MOVEMENT HISTORY</span><h2>Recent transfers</h2></div><span>{transferRows?.length??0} shown</span></div>
   <table><thead><tr><th>Transfer</th><th>From</th><th>To</th><th>Items</th><th className="number">Quantity</th><th className="number">Stock value</th><th>Date</th></tr></thead><tbody>{(transferRows??[]).map(transfer=><tr key={transfer.id}><td><strong>{transfer.transfer_number}</strong>{transfer.note&&<small>{transfer.note}</small>}</td><td>{transfer.from_label}</td><td>{transfer.to_label}</td><td>{transfer.stock_transfer_lines.map(line=>`${line.product_name} · ${line.quality_name}`).join(", ")}</td><td className="number">{Number(transfer.total_quantity).toLocaleString("en-LK",{maximumFractionDigits:3})}</td><td className="number">{money.format(Number(transfer.total_value))}</td><td>{new Date(transfer.created_at).toLocaleString("en-LK",{timeZone:"Asia/Colombo"})}</td></tr>)}{!transferRows?.length&&<tr><td colSpan={7} className="table-empty">No stock transfers have been recorded.</td></tr>}</tbody></table>
  </section>
 </>;
}
