"use client";

import {useMemo,useState} from "react";
import {useRouter} from "next/navigation";
import {ArrowLeftRight,MapPin,MoveRight,Search} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {notify} from "@/components/feedback";

export type TransferLocation={id:string;code:string;name:string};
export type TransferCenter={id:string;code:string;name:string;locations:TransferLocation[]};
export type TransferBalance={key:string;centerId:string;locationId:string;productId:string;qualityId:string;centerLabel:string;locationLabel:string;productCode:string;productName:string;qualityName:string;unit:string;quantity:number;value:number};
const money=new Intl.NumberFormat("en-LK",{style:"currency",currency:"LKR"});

export function StockTransferForm({centers,balances}:{centers:TransferCenter[];balances:TransferBalance[]}){
 const router=useRouter();
 const firstCenter=centers[0]?.id??"";
 const nextCenter=centers.find(c=>c.id!==firstCenter)?.id??firstCenter;
 const [fromCenter,setFromCenter]=useState(firstCenter);
 const [toCenter,setToCenter]=useState(nextCenter);
 const [fromLocation,setFromLocation]=useState(centers.find(c=>c.id===firstCenter)?.locations[0]?.id??"");
 const [toLocation,setToLocation]=useState(centers.find(c=>c.id===nextCenter)?.locations.find(l=>nextCenter!==firstCenter||l.id!==(centers.find(c=>c.id===firstCenter)?.locations[0]?.id))?.id??"");
 const [quantities,setQuantities]=useState<Record<string,string>>({});
 const [search,setSearch]=useState("");
 const [note,setNote]=useState("");
 const [busy,setBusy]=useState(false);
 const [requestId,setRequestId]=useState("");
 const fromLocations=centers.find(c=>c.id===fromCenter)?.locations??[];
 const toLocations=centers.find(c=>c.id===toCenter)?.locations??[];
 const sourceStock=useMemo(()=>balances.filter(x=>x.centerId===fromCenter&&x.locationId===fromLocation),[balances,fromCenter,fromLocation]);
 const visibleStock=useMemo(()=>{const term=search.trim().toLowerCase();return sourceStock.filter(x=>!term||`${x.productCode} ${x.productName} ${x.qualityName}`.toLowerCase().includes(term))},[sourceStock,search]);
 const lines=sourceStock.map(item=>({product_id:item.productId,quality_id:item.qualityId,quantity:Number(quantities[item.key]??0)})).filter(line=>line.quantity>0);
 const totalQuantity=lines.reduce((sum,line)=>sum+line.quantity,0);
 const totalValue=sourceStock.reduce((sum,item)=>sum+(Number(quantities[item.key]??0)>0?Number(quantities[item.key])*Math.max(0,item.quantity?item.value/item.quantity:0):0),0);
 const sameLocation=fromCenter===toCenter&&fromLocation===toLocation;

 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(sameLocation)return notify("Choose a different destination location","error");
  if(!lines.length)return notify("Enter a quantity for at least one item","error");
  const operationId=requestId||crypto.randomUUID();
  setRequestId(operationId);setBusy(true);
  const {error}=await createClient().rpc("create_stock_transfer",{p_request:operationId,p_from_center:fromCenter,p_from_location:fromLocation,p_to_center:toCenter,p_to_location:toLocation,p_lines:lines,p_note:note});
  setBusy(false);
  if(error)return notify(error.message,"error");
  notify("Stock transfer completed");
  setRequestId("");setQuantities({});setSearch("");setNote("");
  router.refresh();
 }

 return <div className="stock-transfer-layout">
  <form className="panel stock-transfer-form" onSubmit={submit}>
   <div className="stock-transfer-form-heading"><div><span className="eyebrow dark">NEW MOVEMENT</span><h2>Transfer stock</h2><p>Stock moves immediately when you confirm. The inventory value follows the stock's current average cost.</p></div><span className="stock-transfer-icon"><ArrowLeftRight size={21}/></span></div>
   {!centers.length?<div className="alert error">No centers are available for your account.</div>:<>
    <div className="stock-transfer-route">
     <fieldset><legend><MapPin size={15}/> FROM</legend><label>Center<select value={fromCenter} onChange={event=>{const value=event.target.value;setFromCenter(value);setFromLocation(centers.find(c=>c.id===value)?.locations[0]?.id??"");setQuantities({})}}>{centers.map(center=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select></label><label>Location<select value={fromLocation} onChange={event=>{setFromLocation(event.target.value);setQuantities({})}}>{fromLocations.map(location=><option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label></fieldset>
     <span className="stock-transfer-arrow"><MoveRight size={22}/></span>
     <fieldset><legend><MapPin size={15}/> TO</legend><label>Center<select value={toCenter} onChange={event=>{const value=event.target.value;setToCenter(value);const target=centers.find(c=>c.id===value);setToLocation(target?.locations.find(location=>value!==fromCenter||location.id!==fromLocation)?.id??target?.locations[0]?.id??"")}}>{centers.map(center=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}</select></label><label>Location<select value={toLocation} onChange={event=>setToLocation(event.target.value)}>{toLocations.map(location=><option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></label></fieldset>
    </div>
    {sameLocation&&<div className="alert error">Choose a different destination location. A transfer cannot move stock to the same location.</div>}
    <div className="stock-transfer-item-heading"><div><h3>Items to transfer</h3><p>Only items with available stock at the source are listed.</p></div><div className="stock-transfer-search"><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Find product or quality"/></div></div>
    <div className="stock-transfer-items">{visibleStock.map(item=><label className="stock-transfer-item" key={item.key}><span className="stock-transfer-product"><strong>{item.productCode} · {item.productName}</strong><small>{item.qualityName} · Average cost {money.format(item.quantity>0?item.value/item.quantity:0)} / {item.unit}</small></span><span className="stock-transfer-available">Available <strong>{item.quantity.toLocaleString("en-LK",{maximumFractionDigits:3})} {item.unit}</strong></span><span className="stock-transfer-quantity"><small>Transfer quantity</small><input type="number" min="0" max={item.quantity} step="0.001" value={quantities[item.key]??""} onChange={event=>setQuantities(current=>({...current,[item.key]:event.target.value}))} placeholder="0"/></span></label>)}{!visibleStock.length&&<p className="table-empty">{sourceStock.length?"No items match the search.":"No available stock at this source location."}</p>}</div>
    <label className="stock-transfer-note">Note (optional)<input value={note} onChange={event=>setNote(event.target.value)} maxLength={300} placeholder="e.g. Replenishment for another center"/></label>
    <div className="stock-transfer-submit"><div><span>{lines.length} item type(s) · Total quantity</span><strong>{totalQuantity.toLocaleString("en-LK",{maximumFractionDigits:3})} · {money.format(totalValue)}</strong></div><button className="primary" disabled={busy||sameLocation||!lines.length}>{busy?"Transferring…":"Confirm transfer"}</button></div>
   </>}
  </form>
 </div>;
}
