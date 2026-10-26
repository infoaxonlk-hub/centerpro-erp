"use client";

import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {MapPin,PackageX,Search,TriangleAlert} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {notify} from "@/components/feedback";

export type ScrapLocation={id:string;code:string;name:string};
export type ScrapCenter={id:string;code:string;name:string;locations:ScrapLocation[]};
export type ScrapBalance={key:string;centerId:string;locationId:string;productId:string;qualityId:string;centerLabel:string;locationLabel:string;productCode:string;productName:string;qualityName:string;unit:string;quantity:number;value:number;tracksSacks?:boolean;sacks?:number};
const money=new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"});

export function StockScrapForm({centers,balances}:{centers:ScrapCenter[];balances:ScrapBalance[]}){
 const router=useRouter();
 const [centerId,setCenterId]=useState(centers[0]?.id??"");
 const locations=centers.find(c=>c.id===centerId)?.locations??[];
 const [locationId,setLocationId]=useState(locations[0]?.id??"");
 const [sackCounts,setSackCounts]=useState<Record<string,string>>({});
 const [quantities,setQuantities]=useState<Record<string,string>>({});
 const [search,setSearch]=useState("");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [requestId,setRequestId]=useState("");
 const sourceStock=useMemo(()=>balances.filter(x=>x.centerId===centerId&&x.locationId===locationId),[balances,centerId,locationId]);
 const visibleStock=useMemo(()=>{const term=search.trim().toLowerCase();return sourceStock.filter(x=>!term||`${x.productCode} ${x.productName} ${x.qualityName}`.toLowerCase().includes(term))},[sourceStock,search]);
 const lines=sourceStock.map(item=>({product_id:item.productId,quality_id:item.qualityId,quantity:Number(quantities[item.key]??0),sack_count:item.tracksSacks?(sackCounts[item.key]===""||sackCounts[item.key]===undefined?null:Number(sackCounts[item.key])):0})).filter(line=>line.quantity>0);
 const totalQuantity=lines.reduce((sum,line)=>sum+line.quantity,0);
 const totalValue=sourceStock.reduce((sum,item)=>sum+(Number(quantities[item.key]??0)>0?Number(quantities[item.key])*Math.max(0,item.quantity?item.value/item.quantity:0):0),0);

 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!lines.length)return notify("Enter a quantity for at least one item","error");
  if(reason.trim().length<2)return notify("Enter why the stock is being scrapped","error");
  if(!window.confirm(`Confirm scrap of ${totalQuantity.toLocaleString("en-LK")} total quantity? This will immediately reduce inventory.`))return;
  const operationId=requestId||crypto.randomUUID();
  setRequestId(operationId);setBusy(true);
  const {error}=await createClient().rpc("create_stock_scrap",{p_request:operationId,p_center:centerId,p_location:locationId,p_lines:lines,p_reason:reason.trim()});
  setBusy(false);
  if(error)return notify(error.message,"error");
  notify("Stock scrap recorded and inventory updated");
  setRequestId("");setQuantities({});setSackCounts({});setSearch("");setReason("");
  router.refresh();
 }

 return <div className="stock-scrap-layout">
  <form className="panel stock-scrap-form" onSubmit={submit}>
   <div className="stock-transfer-form-heading"><div><span className="eyebrow dark">NEW INVENTORY RECORD</span><h2>Record scrapped items</h2><p>Choose the center and location, select the quantities, and give a reason. Stock is deducted as soon as you confirm.</p></div><span className="stock-scrap-icon"><PackageX size={21}/></span></div>
   {!centers.length?<div className="alert error">No active center or location is available for your account.</div>:<>
    <div className="stock-scrap-scope"><label><span><MapPin size={15}/> Center</span><select value={centerId} onChange={event=>{const id=event.target.value;setCenterId(id);setLocationId(centers.find(c=>c.id===id)?.locations[0]?.id??"");setQuantities({})}}>{centers.map(center=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select></label><label><span><MapPin size={15}/> Location</span><select value={locationId} onChange={event=>{setLocationId(event.target.value);setQuantities({})}}>{locations.map(location=><option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label></div>
    <div className="stock-scrap-warning"><TriangleAlert size={17}/><span>Scrapping removes the quantity from available stock immediately. Please verify the item and quantity before confirming.</span></div>
    <div className="stock-transfer-item-heading"><div><h3>Items to scrap</h3><p>Only items currently in stock at this location are shown.</p></div><div className="stock-transfer-search"><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Find product or quality"/></div></div>
    <div className="stock-transfer-items">{visibleStock.map(item=><label className="stock-transfer-item" key={item.key}><span className="stock-transfer-product"><strong>{item.productCode} · {item.productName}</strong><small>{item.qualityName} · Average cost {money.format(item.quantity>0?item.value/item.quantity:0)} / {item.unit}</small></span><span className="stock-transfer-available">Available<strong>{item.quantity.toLocaleString("en-LK",{maximumFractionDigits:3})} {item.unit}</strong></span><span className="stock-transfer-quantity"><small>Scrap quantity</small><input type="number" min="0" max={item.quantity} step="0.001" value={quantities[item.key]??""} onChange={event=>setQuantities(current=>({...current,[item.key]:event.target.value}))} placeholder="0"/></span>{item.tracksSacks&&<span className="stock-transfer-quantity stock-transfer-sacks"><small>Sacks to scrap (0 for loose)</small><input aria-label={"Scrap sacks for "+item.productName} type="number" min="0" max={item.sacks??0} step="1" required={Number(quantities[item.key]??0)>0} value={sackCounts[item.key]??""} onChange={event=>setSackCounts(current=>({...current,[item.key]:event.target.value}))}/></span>}</label>)}{!visibleStock.length&&<p className="table-empty">{sourceStock.length?"No items match the search.":"No available stock at this location."}</p>}</div>
    <label className="stock-scrap-reason">Reason for scrap<textarea value={reason} onChange={event=>setReason(event.target.value)} minLength={2} maxLength={500} required rows={3} placeholder="For example: damaged during handling, expired, or spoiled"/></label>
    <div className="stock-transfer-submit"><div><span>{lines.length} item type(s) · Total quantity · Estimated stock value</span><strong>{totalQuantity.toLocaleString("en-LK",{maximumFractionDigits:3})} · {money.format(totalValue)}</strong></div><button className="primary stock-scrap-submit" disabled={busy||!lines.length||reason.trim().length<2}>{busy?"Recording…":"Confirm scrap"}</button></div>
   </>}
  </form>
 </div>;
}
