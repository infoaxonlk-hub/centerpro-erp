"use client";
import {createClient} from '@/lib/supabase/client';
import {savePosDraft,loadPosDraft,clearPosDraft} from '@/lib/offline-pos';
import {farmStorageKey} from '@/lib/farm-services';
import type {FarmBillFormProps} from '@/app/dashboard/farm-services/order-form';
export type FarmOfflineSnapshot={options:FarmBillFormProps;verifiedAt:number};
const LEASE=8*60*60*1000;
export function validFarmSnapshot(snapshot:FarmOfflineSnapshot,userId:string,organizationId:string,now=Date.now()){
 return !!snapshot?.options&&Array.isArray(snapshot.options.services)&&Array.isArray(snapshot.options.customers)&&snapshot.options.userId===userId&&snapshot.options.organizationId===organizationId&&snapshot.verifiedAt<=now&&now-snapshot.verifiedAt<LEASE;
}
export async function primeFarmOfflineShell(){
 if(!('serviceWorker' in navigator))throw new Error('Offline reopening needs a browser with service worker support.');
 await navigator.serviceWorker.ready;
 const response=await fetch('/offline/farm-services');if(!response.ok)throw new Error('Offline screen could not be downloaded.');
 const cache=await caches.open('centerpro-pos-shell-v3');await cache.put('/offline/farm-services',response.clone());
 const html=await response.text(),document=new DOMParser().parseFromString(html,'text/html');
 const urls=new Set(Array.from(document.querySelectorAll('script[src],link[rel=stylesheet]')).map(element=>element.getAttribute('src')??element.getAttribute('href')??'').filter(url=>url.startsWith('/_next/static/')));
 urls.add('/fonts/NotoSansSinhala.ttf');urls.add('/fonts/NotoSansTamil.ttf');
 await Promise.all([...urls].map(async url=>{const r=await fetch(url);if(!r.ok)throw new Error('Some offline assets could not be downloaded. Reconnect and retry.');await cache.put(url,r);}));
}
export async function cacheFarmOptions(options:FarmBillFormProps){
 const{data:{session}}=await createClient().auth.getSession();if(!session||session.user.id!==options.userId)throw new Error('Reconnect as the original user to prepare offline billing.');
 const{initialRequest:_request,...safe}=options;void _request;
 await savePosDraft(farmStorageKey(options.organizationId,options.userId)+':options',{options:safe,verifiedAt:Date.now()} satisfies FarmOfflineSnapshot);
 localStorage.setItem('centerpro:farm:active:'+options.userId,options.organizationId);
 await primeFarmOfflineShell();
}
export async function loadFarmOfflineOptions():Promise<FarmBillFormProps>{
 const client=createClient(),{data:{session}}=await client.auth.getSession();
 if(!session)throw new Error('Reconnect and sign in before opening offline service billing.');
 const org=localStorage.getItem('centerpro:farm:active:'+session.user.id);if(!org)throw new Error('Open New Farm Bill online once for this account to prepare offline billing.');
 const key=farmStorageKey(org,session.user.id)+':options',snapshot=await loadPosDraft<FarmOfflineSnapshot>(key);
 if(!snapshot||!validFarmSnapshot(snapshot,session.user.id,org))throw new Error('Offline access snapshot expired. Reconnect and open New Farm Bill to refresh it.');
 if(navigator.onLine){
  const {data:{user},error}=await client.auth.getUser();const access=await client.rpc('current_business_access');
  if(error||!user||user.id!==session.user.id||access.error)throw new Error('Access verification is unavailable. Reconnect and retry.');
  if(access.data?.organizationId!==org||!access.data.operational||!access.data.enabledModules?.includes('farm_services')||!(access.data.userRole==='super_admin'||access.data.userPermissions?.includes('farm_services'))){await clearPosDraft(key);localStorage.removeItem('centerpro:farm:active:'+session.user.id);throw new Error('Services is no longer available to this account.');}
 }
 return snapshot.options;
}
