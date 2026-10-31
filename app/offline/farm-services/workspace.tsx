"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {createClient} from '@/lib/supabase/client';
import {loadFarmOfflineOptions} from '@/lib/farm-offline';
import {FarmBillForm,type FarmBillFormProps} from '@/app/dashboard/farm-services/order-form';
import '@/app/dashboard/farm-services/farm-services.css';
export function FarmOfflineWorkspace(){
 const[options,setOptions]=useState<FarmBillFormProps|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const load=()=>void loadFarmOfflineOptions().then(value=>{if(active){setOptions(value);setError('');}}).catch(e=>{if(active){setOptions(null);setError(e instanceof Error?e.message:'Offline billing could not be opened.');}});load();const{data:{subscription}}=createClient().auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN'||event==='USER_UPDATED'){setOptions(null);setTimeout(load,0);}});window.addEventListener('online',load);return()=>{active=false;subscription.unsubscribe();window.removeEventListener('online',load);};},[]);
 return <main className="farm-module farm-offline-workspace"><header className="farm-offline-heading"><h1>Farm Services</h1><Link href="/dashboard/farm-services/new">Open online workspace</Link></header>{error?<section className="panel"><p role="alert">{error}</p><Link href="/login">Sign in / reconnect</Link></section>:options?<FarmBillForm key={options.organizationId+':'+options.userId} {...options} offlineShell/>:<p role="status">Checking this device&apos;s saved account...</p>}</main>;
}
