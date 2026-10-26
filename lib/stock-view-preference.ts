"use client";
import {useSyncExternalStore} from "react";
export const stockViewOptions=[
 {value:"cards",label:"Product cards"},
 {value:"table",label:"Detailed table"},
 {value:"chart",label:"Stock graph"},
 {value:"fsn",label:"Movement (FSN)"},
] as const;
export type StockViewMode=typeof stockViewOptions[number]["value"];
const key="centerpro-stock-view",eventName="centerpro-stock-view-change";
let memory:StockViewMode="cards",storageUnavailable=false;
function valid(value:string|null):value is StockViewMode{return stockViewOptions.some(option=>option.value===value);}
function snapshot():StockViewMode {
 if(storageUnavailable)return memory;
 try{const value=localStorage.getItem(key);return valid(value)?value:"cards";}catch{return memory;}
}
function subscribe(changed:()=>void){
 const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)changed();};
 window.addEventListener("storage",storage);window.addEventListener(eventName,changed);
 return()=>{window.removeEventListener("storage",storage);window.removeEventListener(eventName,changed);};
}
export function setStockViewPreference(value:StockViewMode){
 memory=value;
 try{localStorage.setItem(key,value);storageUnavailable=false;}catch{storageUnavailable=true;}
 window.dispatchEvent(new Event(eventName));
}
export function useStockViewPreference():readonly[StockViewMode,typeof setStockViewPreference]{
 const value=useSyncExternalStore(subscribe,snapshot,()=>"cards" as StockViewMode);
 return[value,setStockViewPreference] as const;
}
