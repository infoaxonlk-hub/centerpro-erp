"use client";
import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {Archive,Check,ChevronLeft,ChevronRight,LayoutGrid,Pencil,Plus,RotateCcw,Search,Store,Table2,Trash2,X,ShieldCheck} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {notify} from "@/components/feedback";
import {effectiveSupplierBaseFields,type StandardSupplierOverride} from "@/lib/supplier-field-config";
import type {SupplierField} from "@/components/supplier-excel-manager";
import "./supplier-directory.css";

type Supplier={id:string;name:string;nic_or_registration:string|null;phone:string|null;address:string|null;bank_details:string|null;notes:string|null;is_active:boolean;custom_values:Record<string,string|number>|null};
type Field={key:string;label:string;type:"text"|"number"|"date";required:boolean;custom:boolean};
type Dialog={mode:"edit"|"archive"|"restore";supplier:Supplier}|null;
const PAGE_SIZE=40;
type BaseKey="name"|"nic_or_registration"|"phone"|"address"|"bank_details"|"notes";
function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+"T00:00:00Z");return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value}
function columnLetter(i:number){let s="";let n=i+1;while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
function valueOf(s:Supplier,f:Field){const v=f.custom?s.custom_values?.[f.key.slice(7)]:s[f.key as BaseKey];return v==null?"":String(v)}
function cut(v:string,n:number){return !v?"—":v.length>n?v.slice(0,n)+"…":v}

export function SupplierDirectory({organizationId,canManage,initialSuppliers}:{organizationId:string;canManage:boolean;initialSuppliers:Supplier[]}){
 const [suppliers,setSuppliers]=useState(initialSuppliers);
 const [view,setView]=useState<"tiles"|"table">("tiles");
 const [search,setSearch]=useState("");
 const [showRemoved,setShowRemoved]=useState(false);
 const [page,setPage]=useState(0);
 const [custom,setCustom]=useState<SupplierField[]>([]);
 const [overrides,setOverrides]=useState<StandardSupplierOverride[]>([]);
 const [dialog,setDialog]=useState<Dialog>(null);
 const [draft,setDraft]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
  let alive=true;const sb=createClient();
  void Promise.all([
   sb.from("supplier_custom_fields").select("id,field_key,label,field_type,is_required,is_active,sort_order").eq("organization_id",organizationId).order("sort_order"),
   sb.from("supplier_standard_fields").select("field_key,label,is_required,is_active").eq("organization_id",organizationId)
  ]).then(([c,s])=>{
   if(!alive)return;
   if(c.error||s.error){setError(c.error?.message??s.error?.message??"Could not load field settings");return}
   setCustom((c.data??[]) as SupplierField[]);
   setOverrides((s.data??[]) as StandardSupplierOverride[]);
  });
  return()=>{alive=false};
 },[organizationId]);
 const columns:Field[]=useMemo(()=>[
   ...effectiveSupplierBaseFields(overrides).filter(f=>f.active).map(f=>({key:f.key,label:f.label,type:"text" as const,required:f.required,custom:false})),
   ...custom.filter(f=>f.is_active).sort((a,b)=>a.sort_order-b.sort_order).map(f=>({key:"custom:"+f.field_key,label:f.label,type:f.field_type,required:f.is_required,custom:true}))
 ],[overrides,custom]);
 const activeCount=suppliers.filter(s=>s.is_active).length;
 const removedCount=suppliers.length-activeCount;
 const filtered=useMemo(()=>{
  const q=search.trim().toLowerCase();
  return suppliers.filter(s=>(showRemoved||s.is_active)&&(!q||
   [s.name,s.nic_or_registration,s.phone,s.address,s.bank_details,s.notes,...Object.values(s.custom_values??{})]
    .some(v=>String(v??"").toLowerCase().includes(q))
  )).sort((a,b)=>a.name.localeCompare(b.name));
 },[suppliers,search,showRemoved]);
 const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
 const shownPage=Math.min(page,pageCount-1);
 const rows=filtered.slice(shownPage*PAGE_SIZE,(shownPage+1)*PAGE_SIZE);
 const openEdit=(s:Supplier)=>{
  const data:Record<string,string>={};for(const f of columns)data[f.key]=valueOf(s,f);
  setDraft(data);setError("");setDialog({mode:"edit",supplier:s});
 };
 const close=()=>{if(!busy){setDialog(null);setError("")}};
 async function saveEdit(){
  if(!dialog||dialog.mode!=="edit"||busy)return;
  const patch:Record<string,unknown>={};
  const customValues:Record<string,string|number>={...(dialog.supplier.custom_values??{})};
  for(const field of columns){
   const v=(draft[field.key]??"").trim();
   if(field.required&&!v){setError(field.label+" is required");return}
   const max=field.custom?500:field.key==="name"?200:field.key==="phone"?60:5000;
   if(v.length>max){setError(field.label+" exceeds "+max+" characters");return}
   if(field.custom){
    const key=field.key.slice(7);
    if(!v){delete customValues[key];continue}
    if(field.type==="number"){
     const n=Number(v);if(!Number.isFinite(n)){setError(field.label+" requires a number");return}
     customValues[key]=n;
    }else if(field.type==="date"){
     if(!validDate(v)){setError(field.label+" requires a valid date");return}
     customValues[key]=v;
    }else customValues[key]=v;
   }else patch[field.key]=field.key==="name"?v:v||null;
  }
  patch.custom_values=customValues;
  setError("");setBusy(true);
  try{
   const {data,error:e}=await createClient().from("suppliers").update(patch).eq("organization_id",organizationId).eq("id",dialog.supplier.id)
    .select("id,name,nic_or_registration,phone,address,bank_details,notes,is_active,custom_values").single();
   if(e)throw e;
   if(!data)throw new Error("Supplier was not updated");
   setSuppliers(prev=>prev.map(s=>s.id===data.id?data as Supplier:s));
   setDialog(null);notify("Supplier updated successfully");
  }catch(e){setError(e instanceof Error?e.message:"Unable to update supplier")}
  finally{setBusy(false)}
 }
 async function setActive(){
  if(!dialog||dialog.mode==="edit"||busy)return;
  const next=dialog.mode==="restore",id=dialog.supplier.id;
  setError("");setBusy(true);
  try{
   const {data,error:e}=await createClient().from("suppliers").update({is_active:next}).eq("organization_id",organizationId).eq("id",id).select("id,is_active").single();
   if(e)throw e;
   if(!data)throw new Error("Supplier status change was not permitted");
   setSuppliers(prev=>prev.map(s=>s.id===id?{...s,is_active:next}:s));
   setDialog(null);setPage(0);
   notify(next?"Supplier restored":"Supplier removed from active list. Purchase history is preserved.");
  }catch(e){setError(e instanceof Error?e.message:"Unable to change supplier status")}
  finally{setBusy(false)}
 }
 function actions(s:Supplier){
  if(!canManage)return null;
  return <div className="sd-actions">
   <button type="button" title={"Edit "+s.name} aria-label={"Edit "+s.name} onClick={()=>openEdit(s)}><Pencil size={15}/></button>
   <button type="button" className={s.is_active?"sd-delete":"sd-restore"} title={(s.is_active?"Remove ":"Restore ")+s.name} aria-label={(s.is_active?"Remove ":"Restore ")+s.name}
    onClick={()=>{setError("");setDialog({mode:s.is_active?"archive":"restore",supplier:s})}}>
    {s.is_active?<Trash2 size={15}/>:<RotateCcw size={15}/>}
   </button>
  </div>;
 }
 return <section className="sd-root">
   <div className="sd-bar"><div><strong>{activeCount.toLocaleString()} suppliers</strong><span>Shared supplier master across permitted centers.</span></div>
    {canManage&&<Link className="primary sd-add" href="/dashboard/masters/suppliers/new"><Plus size={16}/> Add supplier</Link>}</div>
   <div className="sd-toolbar"><div className="sd-search"><Search size={17}/><input aria-label="Search suppliers" value={search}
     onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Search name, NIC, phone, address or custom fields…"/>
     {!!search&&<button aria-label="Clear search" onClick={()=>{setSearch("");setPage(0)}}><X size={15}/></button>}</div>
    <div className="sd-toggle" role="group" aria-label="Supplier view mode">
     <button type="button" aria-pressed={view==="tiles"} className={view==="tiles"?"active":""} onClick={()=>setView("tiles")}><LayoutGrid size={16}/> Tiles</button>
     <button type="button" aria-pressed={view==="table"} className={view==="table"?"active":""} onClick={()=>setView("table")}><Table2 size={16}/> Table</button>
    </div>
   </div>
   <div className="sd-controls"><div>Showing <strong>{filtered.length?(shownPage*PAGE_SIZE+1).toLocaleString():0}–{Math.min((shownPage+1)*PAGE_SIZE,filtered.length).toLocaleString()}</strong> of <strong>{filtered.length.toLocaleString()}</strong> suppliers</div>
    <div className="sd-controls-right"><label className="sd-show-removed"><input type="checkbox" checked={showRemoved} onChange={e=>{setShowRemoved(e.target.checked);setPage(0)}}/> Show removed {removedCount>0?"("+removedCount+")":""}</label>
     <div className="sd-pages"><button aria-label="Previous page" disabled={shownPage===0} onClick={()=>setPage(v=>Math.max(0,v-1))}><ChevronLeft size={16}/></button><span>{shownPage+1} / {pageCount}</span><button aria-label="Next page" disabled={shownPage===pageCount-1} onClick={()=>setPage(v=>v+1)}><ChevronRight size={16}/></button></div>
    </div></div>
   {error&&!dialog&&<div role="alert" className="sd-alert">{error}</div>}
   {view==="tiles"?<div className="sd-grid">{rows.map(s=><article key={s.id} className={"sd-card"+(!s.is_active?" removed":"")}>
     <header className="sd-card-head"><span className="sd-symbol"><Store size={19}/></span><div className="sd-card-name"><strong title={s.name}>{s.name}</strong><small>{s.nic_or_registration||"No NIC / BR"}</small></div>
      <span className={"sd-status"+(s.is_active?"":" off")}>{s.is_active?"Active":"Removed"}</span></header>
     <div className="sd-card-data">{columns.filter(f=>f.key!=="name"&&f.key!=="nic_or_registration").map(f=>{
      const v=valueOf(s,f);return <div key={f.key}><span>{f.label}</span><strong title={v}>{cut(v,90)}</strong></div>
     })}</div>
     {canManage&&<footer className="sd-card-footer"><span>Supplier details</span>{actions(s)}</footer>}
   </article>)}
   {rows.length===0&&<div className="sd-empty">No suppliers match your search.</div>}</div>:
   <div className="sd-sheet-wrap" role="region" aria-label="Supplier spreadsheet table" tabIndex={0}><table className="sd-sheet">
     <thead><tr className="sd-sheet-letters"><th className="sd-number">#</th>{columns.map((f,i)=><th key={f.key}>{columnLetter(i)}</th>)}<th>{columnLetter(columns.length)}</th>{canManage&&<th>{columnLetter(columns.length+1)}</th>}</tr>
     <tr className="sd-sheet-head"><th className="sd-number">Row</th>{columns.map(f=><th key={f.key}>{f.label}{f.required&&<em>*</em>}</th>)}<th>Status</th>{canManage&&<th>Actions</th>}</tr></thead>
     <tbody>{rows.map((s,i)=><tr key={s.id} className={!s.is_active?"sd-muted":""}>
      <td className="sd-number">{shownPage*PAGE_SIZE+i+1}</td>
      {columns.map(f=>{const v=valueOf(s,f);return <td key={f.key} className={f.key==="name"?"sd-name":""} title={v}>{cut(v,130)}</td>})}
      <td><span className={"sd-status"+(s.is_active?"":" off")}>{s.is_active?"Active":"Removed"}</span></td>
      {canManage&&<td className="sd-cell-actions">{actions(s)}</td>}
     </tr>)}{!rows.length&&<tr><td colSpan={columns.length+(canManage?3:2)} className="sd-empty">No suppliers found</td></tr>}</tbody>
   </table></div>}
   {view==="table"&&<p className="sd-sheet-note">Scroll horizontally for more columns. Only {PAGE_SIZE} suppliers appear per page to keep the table responsive.</p>}
   {dialog&&<div className="sd-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section role="dialog" aria-modal="true" aria-labelledby="sd-dialog-title" className="sd-dialog">
    <header className="sd-dialog-head"><span className="sd-modal-symbol">{dialog.mode==="edit"?<Pencil size={20}/>:dialog.mode==="archive"?<Archive size={20}/>:<RotateCcw size={20}/>}</span><div><small>SUPPLIER DIRECTORY</small><h2 id="sd-dialog-title">{dialog.mode==="edit"?"Edit supplier":dialog.mode==="archive"?"Remove supplier?":"Restore supplier?"}</h2><p>{dialog.supplier.name}</p></div><button aria-label="Close" disabled={busy} onClick={close}><X size={19}/></button></header>
    {error&&<div className="sd-alert" role="alert">{error}</div>}
    {dialog.mode==="edit"?<form onSubmit={e=>{e.preventDefault();void saveEdit()}}><div className="sd-edit-grid">{columns.map(f=><label key={f.key} className={["address","bank_details","notes"].includes(f.key)?"wide":""}>
     <span>{f.label}{f.required&&<b> *</b>}</span>
     {!f.custom&&["address","bank_details","notes"].includes(f.key)?<textarea rows={2} value={draft[f.key]??""} disabled={busy} onChange={e=>setDraft(p=>({...p,[f.key]:e.target.value}))}/>:
       <input type={f.type==="number"?"number":f.type==="date"?"date":"text"} step={f.type==="number"?"any":undefined} required={f.required} disabled={busy}
        maxLength={f.type==="text"?(f.custom?500:f.key==="name"?200:f.key==="phone"?60:5000):undefined}
        value={draft[f.key]??""} onChange={e=>setDraft(p=>({...p,[f.key]:e.target.value}))}/>}
    </label>)}</div><footer className="sd-dialog-footer"><span><ShieldCheck size={15}/> Saved to your business</span><div><button type="button" className="sd-cancel" disabled={busy} onClick={close}>Cancel</button><button type="submit" disabled={busy} className="sd-save"><Check size={16}/>{busy?"Saving…":"Save changes"}</button></div></footer></form>:
    <><div className="sd-confirm"><p>{dialog.mode==="archive"?"This supplier will disappear from the active list and new selections. Existing purchase orders, payables and transaction history will remain intact.":"This supplier will become available for new transactions again."}</p></div>
    <footer className="sd-dialog-footer"><span><ShieldCheck size={15}/> Historical records are preserved</span><div><button className="sd-cancel" disabled={busy} onClick={close}>Cancel</button><button disabled={busy} className={dialog.mode==="archive"?"sd-remove":"sd-save"} onClick={()=>void setActive()}>{dialog.mode==="archive"?<Trash2 size={16}/>:<RotateCcw size={16}/>} {busy?"Saving…":dialog.mode==="archive"?"Remove supplier":"Restore supplier"}</button></div></footer></>}
   </section></div>}
 </section>;
}
