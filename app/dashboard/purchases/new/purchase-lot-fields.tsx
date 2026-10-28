"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import type {PurchaseLotSelection} from "@/lib/purchase-lots";
import "./purchase-lots.css";

type Lot={id:string;lot_number:string};
export function PurchaseLotFields({organizationId,productId,qualityId,value,quantity,sacks,requireSacks,onChange,onSplit}:{
 organizationId:string;productId:string;qualityId:string;value?:PurchaseLotSelection;quantity:number;sacks:number;requireSacks:boolean;
 onChange:(choice:PurchaseLotSelection)=>void;onSplit:(quantity:number,sacks:number)=>void;
}){
 const mode=value?.mode??"auto";
 const [search,setSearch]=useState(""),[lots,setLots]=useState<Lot[]>([]),[message,setMessage]=useState("");
 const [splitQuantity,setSplitQuantity]=useState(""),[splitSacks,setSplitSacks]=useState("");
 useEffect(()=>{
  if(mode!=="existing")return;
  let cancelled=false;
  const timer=setTimeout(async()=>{
   if(!navigator.onLine){setLots([]);setMessage("Connect to search lots. Saved selections will be kept while offline.");return;}
   const literal=search.trim().replace(/[\\%_]/g,"\\$&");
   try{
    const {data,error}=await createClient().from("purchase_lots").select("id,lot_number")
     .eq("organization_id",organizationId).eq("product_id",productId).eq("quality_id",qualityId)
     .ilike("lot_number",`%${literal}%`).order("lot_number").limit(20);
    if(cancelled)return;
    setLots(data??[]);setMessage(error?"Lot search could not be loaded. Retry your search when connected.":data?.length===20?"Showing the first 20 matches. Narrow your search.":!data?.length?"No matching lots. Enter a lot number or generate a new one.":"");
   }catch{if(!cancelled){setLots([]);setMessage("Lot search could not be loaded. Your saved selection is unchanged.");}}
  },250);
  return()=>{cancelled=true;clearTimeout(timer);};
 },[mode,search,organizationId,productId,qualityId]);
 return <div className="purchase-lot-fields" onKeyDown={event=>event.stopPropagation()}>
  <label>Lot / Batch<select aria-label="Lot / Batch mode" value={mode} onChange={event=>onChange({mode:event.target.value as PurchaseLotSelection["mode"]})}>
   <option value="auto">Generate on confirmation</option><option value="number">Enter a lot number</option><option value="existing">Search existing lots</option>
  </select></label>
  {mode==="auto"&&<small>A new lot number will be assigned when this purchase is confirmed.</small>}
  {mode==="number"&&<label>Lot number<input aria-label="Lot number" maxLength={80} value={value?.number??""} onChange={event=>onChange({mode:"number",number:event.target.value})} placeholder="e.g. PEPPER-2026-01"/><small>An existing number adds a new receipt; previous receipt prices stay unchanged.</small></label>}
  {mode==="existing"&&<div className="purchase-lot-search"><label>Search lot number<input aria-label="Search lot number" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Type a lot number..."/></label>
   {value?.lot_id&&<p className="purchase-lot-selected">Selected: <b>{value.number??value.lot_id}</b></p>}
   <div className="purchase-lot-results">{lots.map(lot=><button type="button" aria-pressed={value?.lot_id===lot.id} key={lot.id} onClick={()=>onChange({mode:"existing",lot_id:lot.id,number:lot.lot_number})}>{lot.lot_number}</button>)}</div>
   {message&&<small role="status">{message}</small>}
  </div>}
  <details className="purchase-lot-split"><summary>Split quantity into another lot row</summary><small>The new row is subtracted from this row. Total quantity, sacks and unit price are preserved.</small>
   <label>Quantity in new row<input aria-label="Quantity in new lot row" type="number" min="0.001" step="0.001" max={Math.max(0,quantity-.001)} value={splitQuantity} onChange={event=>setSplitQuantity(event.target.value)}/></label>
   {(sacks>0||requireSacks)&&<label>Sacks in new row<input aria-label="Sacks in new lot row" type="number" min={requireSacks?1:0} max={requireSacks?sacks-1:sacks} step="1" value={splitSacks} onChange={event=>setSplitSacks(event.target.value)}/></label>}
   <button type="button" className="ghost" onClick={()=>{onSplit(Number(splitQuantity),Number(splitSacks||0));}}>Split row</button>
  </details>
 </div>;
}
