"use client";
import {useEffect,useState} from "react";
import {CircleCheck,TriangleAlert,X} from "lucide-react";
type Notice={id:number;type:"success"|"error";message:string};
export function notify(message:string,type:Notice["type"]="success"){window.dispatchEvent(new CustomEvent("collectpro-notice",{detail:{message,type}}))}
export function FeedbackHost(){const[notices,setNotices]=useState<Notice[]>([]);useEffect(()=>{const receive=(event:Event)=>{const detail=(event as CustomEvent).detail;const id=Date.now()+Math.random();setNotices(old=>[...old,{id,...detail}]);window.setTimeout(()=>setNotices(old=>old.filter(item=>item.id!==id)),4000)};window.addEventListener("collectpro-notice",receive);return()=>window.removeEventListener("collectpro-notice",receive)},[]);return <div className="toast-stack" aria-live="polite">{notices.map(item=><div key={item.id} className={`toast ${item.type}`}>{item.type==="success"?<CircleCheck size={21}/>:<TriangleAlert size={21}/>}<span>{item.message}</span><button onClick={()=>setNotices(old=>old.filter(x=>x.id!==item.id))} aria-label="Close notification"><X size={17}/></button></div>)}</div>}
