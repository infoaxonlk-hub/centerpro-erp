"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { moduleForPath, moduleEnabled, type BusinessAccess } from "@/lib/business-modules";
export function BusinessAccessMonitor({initial,isSuperAdmin}:{initial:BusinessAccess;isSuperAdmin:boolean}) {
 const router=useRouter(),path=usePathname(),previous=useRef(JSON.stringify(initial));
 useEffect(()=>{
   let active=true;
   async function check(){
     if(!navigator.onLine)return;
     try{
       const response=await fetch("/api/business-access",{cache:"no-store"});
       if(!active)return;
       if(response.status===401||response.status===403){router.replace("/login?error=Your account is inactive or unavailable");return;}
       if(!response.ok)return;
       const business:BusinessAccess=await response.json();
       if(!active)return;
       const safe=/^\/dashboard\/(account|restricted)(\/|$)/.test(path)||(isSuperAdmin&&path.startsWith("/dashboard/businesses"));
       if(!safe&&!business.operational){router.replace("/dashboard/account");return;}
       const key=moduleForPath(path);
       if(!safe&&key&&!moduleEnabled(key,business.enabledModules)){router.replace("/dashboard/restricted?module="+key);return;}
       const serialized=JSON.stringify(business);
       if(serialized!==previous.current){previous.current=serialized;router.refresh();}
     }catch{/* Offline drafts remain local; the database rechecks every posting. */}
   }
   const timer=window.setInterval(()=>void check(),30000);
   const focus=()=>void check();window.addEventListener("focus",focus);window.addEventListener("online",focus);
   return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",focus);window.removeEventListener("online",focus);};
 },[router,path,isSuperAdmin]);
 return null;
}
