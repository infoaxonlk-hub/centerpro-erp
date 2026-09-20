"use client";
import {useEffect,useRef,useState,useTransition} from "react";
import Link from "next/link";
import {Bell,CheckCheck,Tag,X} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
export type AdminNotification={id:string;type:string;title:string;message:string;isRead:boolean;createdAt:string;center:string};
export function NotificationBell({initialNotifications}:{initialNotifications:AdminNotification[]}){
 const[items,setItems]=useState(initialNotifications),[open,setOpen]=useState(false),[pending,start]=useTransition(),box=useRef<HTMLDivElement>(null),unread=items.filter(x=>!x.isRead).length;
 useEffect(()=>{const close=(e:MouseEvent)=>{if(box.current&&!box.current.contains(e.target as Node))setOpen(false)};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);
 function mark(ids:string[]){if(!ids.length)return;start(async()=>{const{error}=await createClient().from("notifications").update({is_read:true}).in("id",ids);if(!error)setItems(old=>old.map(x=>ids.includes(x.id)?{...x,isRead:true}:x))})}
 function toggle(){const next=!open;setOpen(next);if(next)mark(items.filter(x=>!x.isRead).map(x=>x.id))}
 return <div className="notification-bell" ref={box}><button className="bell-button" onClick={toggle} aria-label="Notifications"><Bell/>{unread>0&&<span>{unread>99?"99+":unread}</span>}</button>{open&&<div className="notification-popover"><header><div><b>Notifications</b><small>{unread?`${unread} unread alert(s)`:"You are all caught up"}</small></div><div>{unread>0&&<button disabled={pending} onClick={()=>mark(items.filter(x=>!x.isRead).map(x=>x.id))} title="Mark all as read"><CheckCheck/></button>}<button onClick={()=>setOpen(false)} title="Close"><X/></button></div></header><div className="notification-popover-list">{items.map(x=><article className={x.isRead?"":"unread"} key={x.id}><span className="notice-type"><Tag/></span><div><b>{x.title}</b><p>{x.message}</p>{x.center&&<small>{x.center} · {new Date(x.createdAt).toLocaleString("en-LK")}</small>}</div></article>)}{!items.length&&<div className="popover-empty"><Bell/>No notifications yet.</div>}</div><footer><Link href="/dashboard/cash">Open cash receipts</Link></footer></div>}</div>
}
