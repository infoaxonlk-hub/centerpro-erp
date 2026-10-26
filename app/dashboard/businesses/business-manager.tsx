"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building2, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { ModuleAccessChecklist } from "@/components/module-access-checklist";
import { BusinessAdminAccess } from "@/components/business-admin-access";
import type { BusinessModuleKey } from "@/lib/business-modules";
import type { BusinessRecord, Subscription, SubscriptionHistory } from "@/lib/business-types";
type Draft = {details:{name:string;status:"active"|"suspended";address:string;phone:string;email:string};subscription:Subscription;modules:BusinessModuleKey[];adminName:string;adminEmail:string;password:string};
const today = () => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Colombo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const emptyDraft=():Draft=>({details:{name:"",status:"active",address:"",phone:"",email:""},subscription:{plan:"Custom",status:"active",starts_on:today(),expires_on:null,trial_ends_on:null,admin_notes:""},modules:["dashboard"],adminName:"",adminEmail:"",password:""});
const formatDate=(date:string|null)=>date?new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Colombo"}).format(new Date(date.length===10?date+"T00:00:00+05:30":date)):"No expiry";
async function jsonRequest(url:string,options?:RequestInit) {
 const response=await fetch(url,{cache:"no-store",...options});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error??"The request could not be completed.");
 return data;
}
export function BusinessManager() {
 const dialogRef=useRef<HTMLElement>(null);
 const [businesses,setBusinesses]=useState<BusinessRecord[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[success,setSuccess]=useState(""),[search,setSearch]=useState(""),[filter,setFilter]=useState("all");
 const [editor,setEditor]=useState<{id:string|null;readOnly:boolean;tab:string}|null>(null),[draft,setDraft]=useState<Draft>(emptyDraft),[history,setHistory]=useState<SubscriptionHistory[]>([]);
 useEffect(()=>{let active=true;jsonRequest("/api/admin/businesses").then(data=>{if(active)setBusinesses(data);}).catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 async function refresh(){setBusinesses(await jsonRequest("/api/admin/businesses"));}
 async function open(business:BusinessRecord,tab="information",readOnly=false) {
   setError("");setSuccess("");setBusy(true);
   try {
     const result=await jsonRequest("/api/admin/businesses/"+business.id);
     const current:BusinessRecord=result.business;
     setDraft({details:{name:current.name,status:current.business_status==="active"?"active":"suspended",address:current.receipt_address??"",phone:current.receipt_phone??"",email:current.receipt_email??""},subscription:current.business_subscriptions??emptyDraft().subscription,
       modules:current.business_module_entitlements.filter(m=>m.enabled).map(m=>m.module_key),adminName:"",adminEmail:"",password:""});
     setHistory(result.history??[]);setEditor({id:current.id,tab,readOnly});
   } catch(error){setError(error instanceof Error?error.message:"Unable to open business.");}finally{setBusy(false);}
 }
 async function save(event:React.FormEvent) {
   event.preventDefault();if(!editor||editor.readOnly)return;
   if(editor.id&&draft.details.status==="suspended"&&!window.confirm("Suspend this business? Existing data will be kept, and business users will lose operational access."))return;
   setBusy(true);setError("");setSuccess("");
   try {
     await jsonRequest("/api/admin/businesses"+(editor.id?"/"+editor.id:""),{method:editor.id?"PATCH":"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify(editor.id?{details:draft.details,subscription:draft.subscription,modules:draft.modules}:draft)});
     setSuccess(editor.id?"Business configuration saved. Use Administrator access to grant any missing user permissions.":"Business and administrator created. Share the sign-in email and password securely.");
     setEditor(null);setDraft(emptyDraft());await refresh();
   }catch(error){setError(error instanceof Error?error.message:"Unable to save business.");}finally{setBusy(false);}
 }
 async function changeStatus(business:BusinessRecord) {
   const status=business.business_status==="active"?"suspended":"active";
   if(status==="suspended"&&!window.confirm("Suspend "+business.name+"? Users will lose operational access. Existing data will be kept."))return;
   setBusy(true);setError("");setSuccess("");
   try{
     // Fetch fresh settings so a status action does not overwrite older subscription/module data.
     const {business:current}=await jsonRequest("/api/admin/businesses/"+business.id) as {business:BusinessRecord};
     await jsonRequest("/api/admin/businesses/"+business.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
       details:{name:current.name,status,address:current.receipt_address??"",phone:current.receipt_phone??"",email:current.receipt_email??""},
       subscription:current.business_subscriptions,modules:current.business_module_entitlements.filter(m=>m.enabled).map(m=>m.module_key),
     })});
     setSuccess(status==="active"?"Business reactivated. Subscription and module rules still apply.":"Business suspended.");await refresh();
   }catch(error){setError(error instanceof Error?error.message:"Unable to change business status.");}finally{setBusy(false);}
 }
 async function grantAdminAccess(admin:Pick<BusinessRecord["profiles"][number],"id"|"full_name">) {
   if(!editor?.id||editor.readOnly)return;
   setBusy(true);setError("");setSuccess("");
   try{
     await jsonRequest("/api/admin/businesses/"+editor.id+"/admins/"+admin.id+"/access",{method:"POST"});
     await refresh();
     setSuccess("Enabled-module access granted to "+admin.full_name+". They can refresh their workspace now.");
   }catch(error){setError(error instanceof Error?error.message:"Unable to grant administrator access.");}
   finally{setBusy(false);}
 }
 const visible=businesses.filter(b=>{
   const text=[b.name,b.id,...b.profiles.filter(p=>p.role==="admin").flatMap(p=>[p.full_name,p.email])].join(" ").toLowerCase();
   return text.includes(search.toLowerCase())&&(filter==="all"||filter===b.business_status||filter===b.access_summary?.expiry||filter===b.access_summary?.effectiveStatus);
 });
 const dialogOpen=editor!==null;
 useEffect(()=>{
   if(!dialogOpen)return;
   const previous=document.activeElement as HTMLElement|null;
   dialogRef.current?.querySelector<HTMLElement>("button,input,select,textarea,a[href]")?.focus();
   return()=>previous?.focus();
 },[dialogOpen]);
 function dialogKey(event:React.KeyboardEvent<HTMLElement>){
   if(event.key==="Escape"&&!busy){setEditor(null);setDraft(emptyDraft());return;}
   if(event.key!=="Tab")return;
   const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]")).filter(element=>element.getClientRects().length>0);
   const first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
 const selected=businesses.find(b=>b.id===editor?.id);
 const savedModules=selected?.business_module_entitlements.filter(m=>m.enabled).map(m=>m.module_key)??[];
 const moduleChangesPending=!!editor?.id&&[...savedModules].sort().join(",")!==[...draft.modules].sort().join(",");
 const updateSubscription=(values:Partial<Subscription>)=>setDraft({...draft,subscription:{...draft.subscription,...values}});
 return <div className="business-portal">
  <div className="page-heading"><div><span className="eyebrow dark">INFOAXON PLATFORM</span><h1>Businesses</h1><p>Manage business workspaces, subscriptions and module access.</p></div>
   <button className="primary" disabled={busy} onClick={()=>{setDraft(emptyDraft());setHistory([]);setEditor({id:null,readOnly:false,tab:"information"});setError("");setSuccess("");}}><Plus size={17}/> Create business</button></div>
  {error&&<p className="alert error" role="alert">{error}</p>}{!editor&&success&&<p className="business-success" role="status">{success}</p>}
  <div className="metric-grid"><article className="metric"><span>Total businesses</span><strong>{businesses.length}</strong></article>
   <article className="metric"><span>Active businesses</span><strong>{businesses.filter(b=>b.business_status==="active").length}</strong></article>
   <article className="metric"><span>Suspended</span><strong>{businesses.filter(b=>b.business_status==="suspended").length}</strong></article>
   <article className="metric"><span>Expiring within 30 days</span><strong>{businesses.filter(b=>b.access_summary?.expiry==="expiring").length}</strong></article></div>
  <section className="panel"><div className="business-toolbar"><label className="business-search"><Search size={17}/><input aria-label="Search businesses" placeholder="Search business, ID or administrator" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <label>Filter<select aria-label="Filter businesses" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All businesses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired subscriptions</option><option value="expiring">Expiring soon</option><option value="past_due">Past due</option></select></label></div>
   {loading?<p role="status">Loading businesses...</p>:<div className="business-table-wrap"><table className="business-table"><thead><tr><th>Business</th><th>Administrator</th><th>Status</th><th>Subscription</th><th>Expires</th><th>Modules</th><th>Created</th><th>Actions</th></tr></thead>
    <tbody>{visible.map(b=><tr key={b.id}><td><strong>{b.name}</strong><small className="business-id">{b.id}</small></td>
     <td>{b.profiles.filter(p=>p.role==="admin").map(p=><div className="business-admin" key={p.id}><strong>{p.full_name}</strong><span>{p.email}</span>{!p.is_active&&<small>Inactive administrator</small>}</div>)}</td>
     <td><span className={"status "+(b.business_status==="active"?"active":"inactive")}>{b.business_status}</span></td>
     <td><strong>{b.business_subscriptions?.plan??"Not configured"}</strong><small className="business-sub-status">{b.access_summary?.effectiveStatus??b.business_subscriptions?.status}</small></td>
     <td>{formatDate(b.business_subscriptions?.expires_on??null)}{b.access_summary?.expiry==="expiring"&&<small>Expiring soon</small>}</td>
     <td>{b.business_module_entitlements.filter(m=>m.enabled).length}</td><td>{formatDate(b.created_at)}</td>
     <td><details className="business-actions"><summary aria-label={"Actions for "+b.name}><MoreHorizontal size={20}/></summary><div>
      <button disabled={busy} onClick={()=>void open(b,"information",true)}>View details</button>
      <button disabled={busy} onClick={()=>void open(b)}>Edit business</button>
      <button disabled={busy} onClick={()=>void open(b,"subscription")}>Manage subscription</button>
      <button disabled={busy} onClick={()=>void open(b,"modules")}>Manage modules</button>
      <button disabled={busy} onClick={()=>void open(b,"activity")}>Administrator access</button>
      <button disabled={busy} onClick={()=>void changeStatus(b)}>{b.business_status==="active"?"Suspend business":"Activate / Reactivate"}</button>
      <Link href={"/dashboard/businesses/"+b.id+"/workspace"}>Open Workspace</Link></div></details></td></tr>)}</tbody></table>
     {!visible.length&&<div className="empty-state"><Building2/><h3>No matching businesses</h3><p>Create a business or change your search.</p></div>}</div>}
  </section>
  {editor&&<div className="business-dialog-backdrop"><section ref={dialogRef} onKeyDown={dialogKey} role="dialog" aria-modal="true" aria-label={editor.id?"Business details":"Create business"} className="business-dialog">
   <header><div><h2>{editor.id?draft.details.name:"Create business"}</h2><p>{editor.id??"Create the workspace and its first administrator."}</p></div><button className="ghost" aria-label="Close business details" disabled={busy} onClick={()=>{setEditor(null);setDraft(emptyDraft());}}><X size={18}/></button></header>
   {error&&<p className="alert error" role="alert">{error}</p>}
   {success&&<p className="business-success" role="status">{success}</p>}
   <nav className="business-tabs" aria-label="Business sections">{["information","subscription","modules","activity"].map(tab=><button type="button" key={tab} className={editor.tab===tab?"primary":"ghost"} onClick={()=>setEditor({...editor,tab})}>{tab==="information"?"Business information":tab==="modules"?"Module Access":tab==="activity"?"Administrators & history":"Subscription"}</button>)}</nav>
   <form noValidate onSubmit={save}><fieldset disabled={busy||editor.readOnly}>
    <div hidden={editor.tab!=="information"}><h3>Business information</h3><div className="company-profile-grid">
     <label>Business name<input required minLength={2} maxLength={120} value={draft.details.name} onChange={e=>setDraft({...draft,details:{...draft.details,name:e.target.value}})}/></label>
     <label>Business status<select value={draft.details.status} onChange={e=>setDraft({...draft,details:{...draft.details,status:e.target.value as "active"|"suspended"}})}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
     <label>Contact phone<input maxLength={50} value={draft.details.phone} onChange={e=>setDraft({...draft,details:{...draft.details,phone:e.target.value}})}/></label>
     <label>Contact email<input type="email" value={draft.details.email} onChange={e=>setDraft({...draft,details:{...draft.details,email:e.target.value}})}/></label>
     <label>Address<textarea maxLength={500} value={draft.details.address} onChange={e=>setDraft({...draft,details:{...draft.details,address:e.target.value}})}/></label>
    </div>{!editor.id&&<><h3>First business administrator</h3><div className="company-profile-grid">
     <label>Admin name<input required minLength={2} maxLength={120} autoComplete="off" value={draft.adminName} onChange={e=>setDraft({...draft,adminName:e.target.value})}/></label>
     <label>Admin email<input required type="email" autoComplete="off" value={draft.adminEmail} onChange={e=>setDraft({...draft,adminEmail:e.target.value})}/></label>
     <label>Admin password<input required type="password" minLength={8} maxLength={72} autoComplete="new-password" value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})}/></label></div></>}</div>
    <div hidden={editor.tab!=="subscription"}><h3>Subscription</h3><p>Manual subscription management. Expiration dates include the whole date in Asia/Colombo.</p><div className="company-profile-grid">
     <label>Plan<select value={draft.subscription.plan} onChange={e=>updateSubscription({plan:e.target.value as Subscription["plan"]})}>{["Starter","Professional","Enterprise","Custom"].map(p=><option key={p}>{p}</option>)}</select></label>
     <label>Subscription status<select value={draft.subscription.status} onChange={e=>updateSubscription({status:e.target.value as Subscription["status"]})}>{["trialing","active","past_due","expired","cancelled"].map(p=><option key={p}>{p}</option>)}</select></label>
     <label>Start date<input type="date" required value={draft.subscription.starts_on} onChange={e=>updateSubscription({starts_on:e.target.value})}/></label>
     <label>Expiration date<input type="date" min={draft.subscription.starts_on} value={draft.subscription.expires_on??""} onChange={e=>updateSubscription({expires_on:e.target.value||null})}/></label>
     <label>Trial end date<input type="date" required={draft.subscription.status==="trialing"} min={draft.subscription.starts_on} value={draft.subscription.trial_ends_on??""} onChange={e=>updateSubscription({trial_ends_on:e.target.value||null})}/></label>
     <label>Admin notes<textarea maxLength={4000} rows={4} value={draft.subscription.admin_notes} onChange={e=>updateSubscription({admin_notes:e.target.value})}/></label></div>
     <button className="ghost" type="button" onClick={()=>updateSubscription({status:"active",starts_on:today(),expires_on:null,trial_ends_on:null})}>Renew without expiry</button>
     <p>To renew for a fixed period, set status to active and choose the new expiration date.</p></div>
    <div hidden={editor.tab!=="modules"}><ModuleAccessChecklist value={draft.modules} onChange={modules=>setDraft({...draft,modules})} disabled={busy||editor.readOnly}/>
     {editor.id&&<p>Existing administrators also need matching user permissions. Save module changes, then <button type="button" className="ghost" onClick={()=>setEditor({...editor,tab:"activity"})}>Manage administrator access</button>.</p>}</div>
   </fieldset>
   <div hidden={editor.tab!=="activity"}>
    {moduleChangesPending&&<p className="alert error">Save module changes before granting administrator access.</p>}
    {editor.id&&<BusinessAdminAccess admins={selected?.profiles.filter(p=>p.role==="admin")??[]} enabledModules={savedModules}
      disabled={busy||editor.readOnly||moduleChangesPending} onGrant={admin=>void grantAdminAccess(admin)}/>}
    {!editor.id&&<p>The administrator will be created when you save.</p>}
    {editor.id&&<p><Link className="ghost" href={"/dashboard/businesses/"+editor.id+"/workspace"}>Open Workspace — read-only</Link></p>}
    <h3>Subscription history</h3>{history.map(item=><article className="business-history" key={item.id}><strong>{formatDate(item.created_at)}</strong><p>{item.before_data?.plan??"Initial"} → {item.after_data.plan} · {item.after_data.status}</p><small>Start: {item.after_data.starts_on} · Expiration: {item.after_data.expires_on??"No expiry"} · Trial end: {item.after_data.trial_ends_on??"None"}</small>{item.after_data.admin_notes&&<p>{item.after_data.admin_notes}</p>}</article>)}{!history.length&&<p>No subscription changes recorded.</p>}</div>
   <footer><button className="ghost" type="button" disabled={busy} onClick={()=>{setEditor(null);setDraft(emptyDraft());}}>Close</button>{!editor.readOnly&&<button type="submit" className="primary" disabled={busy}>{busy?"Saving...":editor.id?"Save changes":"Create business & admin"}</button>}</footer>
   </form></section></div>}
 </div>;
}
