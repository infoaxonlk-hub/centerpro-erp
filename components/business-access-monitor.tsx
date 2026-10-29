"use client";
import { useEffect, useRef,useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { moduleForPath, moduleEnabled, type BusinessAccess } from "@/lib/business-modules";
export function BusinessAccessMonitor({initial,isSuperAdmin}:{initial:BusinessAccess;isSuperAdmin:boolean}) {
 const router=useRouter(),path=usePathname(),previous=useRef(JSON.stringify(initial));
 const[warning,setWarning]=useState("");
 useEffect(()=>{
   let active=true,checking=false,invalidResponses=0;
   let retry:ReturnType<typeof setTimeout>|undefined;
   async function check(){
     if(!navigator.onLine||checking)return;
     checking=true;
     try{
       const response=await fetch("/api/business-access",{cache:"no-store",credentials:"same-origin"});
       if(!active)return;
       if(response.status===401){
         invalidResponses++;
         if(invalidResponses>=2){window.location.replace("/login?error=Your session has expired. Please sign in again");return;}
         setWarning("Rechecking your session…");retry=setTimeout(()=>void check(),1000);return;
       }
       if(response.status===403){window.location.replace("/login?error=Your account is inactive or unavailable");return;}
       if(!response.ok){setWarning("Business access could not be checked. Reconnecting…");return;}
       invalidResponses=0;setWarning("");
       const business:BusinessAccess=await response.json();
       if(!active)return;
       const safe=/^\/dashboard\/(account|restricted)(\/|$)/.test(path)||(isSuperAdmin&&path.startsWith("/dashboard/businesses"));
       if(!safe&&!business.operational){router.replace("/dashboard/account");return;}
       const key=moduleForPath(path);
       if(!safe&&key&&!moduleEnabled(key,business.enabledModules)){router.replace("/dashboard/restricted?module="+key);return;}
       const serialized=JSON.stringify(business);
       if(serialized!==previous.current){previous.current=serialized;router.refresh();}
     }catch{if(active)setWarning("Business access could not be checked. Reconnecting…");}
     finally{checking=false;}
   }
   const timer=window.setInterval(()=>void check(),30000);
   const focus=()=>void check();window.addEventListener("focus",focus);window.addEventListener("online",focus);
   return()=>{active=false;clearTimeout(retry);window.clearInterval(timer);window.removeEventListener("focus",focus);window.removeEventListener("online",focus);};
 },[router,path,isSuperAdmin]);
 return warning?<div role="status" className="alert">{warning}</div>:null;
}
