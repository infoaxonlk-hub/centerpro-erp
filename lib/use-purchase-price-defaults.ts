"use client";
import {useEffect,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import type {LatestPurchasePrice} from "./product-price-defaults";

// Only new rows read this snapshot. Never patch prices on a restored/current bill.
export function usePurchasePriceDefaults(organizationId:string,scopeId:string,initial:LatestPurchasePrice[]){
 const [latest,setLatest]=useState(initial);
 useEffect(()=>{
  const key=`centerpro:purchase-prices:${organizationId}:${scopeId}`;
  let active=true,version=0;
  async function refresh(){
   const current=++version;
   await Promise.resolve();
   if(!active)return;
   if(!navigator.onLine){
    try{const saved=localStorage.getItem(key);if(saved){const parsed=JSON.parse(saved);if(Array.isArray(parsed))setLatest(parsed);}}catch{/* Storage may be unavailable. Product defaults still work. */}
    return;
   }
   try{
    const rows:LatestPurchasePrice[]=[];
    for(let offset=0;;offset+=500){const {data,error}=await createClient().rpc("latest_purchase_prices").range(offset,offset+499);if(error)return;rows.push(...(data??[]));if((data??[]).length<500)break;}
    if(!active||current!==version)return;
    setLatest(rows);try{localStorage.setItem(key,JSON.stringify(rows));}catch{}
   }catch{/* Keep last locally available confirmed prices while disconnected. */}
  }
  void refresh();
  window.addEventListener("online",refresh);window.addEventListener("centerpro-purchase-confirmed",refresh);window.addEventListener("focus",refresh);
  return()=>{active=false;window.removeEventListener("online",refresh);window.removeEventListener("centerpro-purchase-confirmed",refresh);window.removeEventListener("focus",refresh);};
 },[organizationId,scopeId]);
 return latest;
}
