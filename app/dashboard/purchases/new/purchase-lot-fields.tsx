"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import type {PurchaseLotSelection} from "@/lib/purchase-lots";
import "./purchase-lots.css";

type Lot={id:string;lot_number:string};
export function PurchaseLotFields({organizationId,productId,qualityId,value,onChange}:{
 organizationId:string;productId:string;qualityId:string;value?:PurchaseLotSelection;
 onChange:(choice:PurchaseLotSelection)=>void;
}){
 const mode=value?.mode??"auto";
 const [search,setSearch]=useState(""),[lots,setLots]=useState<Lot[]>([]),[message,setMessage]=useState("");
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
  <small>One lot and one total received quantity per product in this purchase order.</small>
 </div>;
}
