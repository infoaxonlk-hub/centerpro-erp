"use client";
import {useSyncExternalStore} from "react";
import {createPortal} from "react-dom";
function subscribe(changed:()=>void){
 const observer=new MutationObserver(changed);
 observer.observe(document.body,{childList:true,subtree:true});
 return()=>observer.disconnect();
}
const snapshot=()=>document.getElementById("dashboard-summary-slot");
// The dashboard page owns the data, so client navigation refreshes it even when
// Next reuses the surrounding layout. Portal content stays visible in app modes.
export function DashboardSummaryPlacement({children}:{children:React.ReactNode}){
 const slot=useSyncExternalStore(subscribe,snapshot,()=>null);
 return slot?createPortal(children,slot):children;
}
