"use client";

import {useMemo,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {Asterisk,ArrowRight,Check,ChevronDown,Info,Plus,RotateCcw,Save,ShieldCheck,Trash2,X,Pencil,Users} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {effectiveSupplierBaseFields,type SupplierBaseKey,type StandardSupplierOverride} from "@/lib/supplier-field-config";
import {SupplierExcelManager,type SupplierField} from "@/components/supplier-excel-manager";
import {notify} from "@/components/feedback";
import "./supplier-create-workspace.css";

type FieldItem={key:string;label:string;type:"text"|"number"|"date";required:boolean;active:boolean;kind:"standard"|"custom";id?:string};
const standardKey=(key:string)=>key as SupplierBaseKey;
const dateValid=(v:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+"T00:00:00Z");return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;};

export function SupplierCreateWorkspace({organizationId,initialFields,initialStandardOverrides}:{
 organizationId:string;initialFields:SupplierField[];initialStandardOverrides:StandardSupplierOverride[];
}){
 const router=useRouter();
 const [customFields,setCustomFields]=useState(initialFields);
 const [standardOverrides,setStandardOverrides]=useState(initialStandardOverrides);
 const [values,setValues]=useState<Record<string,string>>({});
 const [editing,setEditing]=useState<string|null>(null);
 const [editLabel,setEditLabel]=useState("");
 const [confirmRemoval,setConfirmRemoval]=useState<string|null>(null);
 const [adding,setAdding]=useState(false);
 const [newName,setNewName]=useState("");
 const [newType,setNewType]=useState<"text"|"number"|"date">("text");
 const [newRequired,setNewRequired]=useState(false);
 const [busy,setBusy]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");

 const standards=useMemo(()=>effectiveSupplierBaseFields(standardOverrides),[standardOverrides]);
 const allFields:FieldItem[]=useMemo(()=>[
  ...standards.map(f=>({...f,kind:"standard" as const})),
  ...[...customFields].sort((a,b)=>a.sort_order-b.sort_order).map(f=>({
   key:"custom:"+f.field_key,label:f.label,type:f.field_type,required:f.is_required,
   active:f.is_active,kind:"custom" as const,id:f.id
  }))
 ],[standards,customFields]);
 const activeFields=allFields.filter(f=>f.active);
 const archivedFields=allFields.filter(f=>!f.active);

 async function reloadCustom(){
  const {data,error:readError}=await createClient().from("supplier_custom_fields")
   .select("id,field_key,label,field_type,is_required,is_active,sort_order")
   .eq("organization_id",organizationId).order("sort_order");
  if(readError)throw readError;
  setCustomFields((data??[]) as SupplierField[]);
 }
 async function reloadStandard(){
  const {data,error:readError}=await createClient().from("supplier_standard_fields")
   .select("field_key,label,is_required,is_active").eq("organization_id",organizationId);
  if(readError)throw readError;
  setStandardOverrides((data??[]) as StandardSupplierOverride[]);
 }
 function findDuplicate(label:string,exceptKey:string){
  return allFields.some(f=>f.active&&f.key!==exceptKey&&f.label.toLocaleLowerCase()===label.toLocaleLowerCase());
 }
 function beginEditing(field:FieldItem){
  setError("");setConfirmRemoval(null);setEditing(field.key);setEditLabel(field.label);
 }
 async function saveField(field:FieldItem,patch:Partial<Pick<FieldItem,"label"|"required"|"active">>){
  if(busy)return false;
  const label=(patch.label??field.label).trim();
  const active=patch.active??field.active;
  const required=active?(patch.required??field.required):false;
  if(label.length<1||label.length>80){setError("Field name must have 1–80 characters.");return false}
  if(active&&findDuplicate(label,field.key)){setError("A different active field already uses that name.");return false}
  if(field.key==="name"&&(!active||!required)){setError("Supplier Name must remain visible and required.");return false}
  setBusy(true);setError("");
  try{
   const sb=createClient();
   if(field.kind==="standard"){
    const {error:writeError}=await sb.from("supplier_standard_fields").upsert({
     organization_id:organizationId,field_key:standardKey(field.key),
     label,is_active:active,is_required:required
    },{onConflict:"organization_id,field_key"});
    if(writeError)throw writeError;
    await reloadStandard();
   }else{
    const {data,error:writeError}=await sb.from("supplier_custom_fields").update({
     label,is_active:active,is_required:required
    }).eq("id",field.id!).eq("organization_id",organizationId).select("id");
    if(writeError)throw writeError;
    if(!data?.length)throw new Error("You do not have permission to update this field.");
    await reloadCustom();
   }
   setEditing(null);setConfirmRemoval(null);
   notify(!active?"Field removed from new forms and Excel templates. Historical values remain.":"Field settings saved.");
   return true;
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not save field settings.");return false}
  finally{setBusy(false)}
 }
 async function createCustomField(){
  if(busy)return;
  const label=newName.trim();
  if(!label||label.length>80){setError("Enter a field name between 1 and 80 characters.");return}
  if(findDuplicate(label,"")){setError("A field with this name already exists.");return}
  if(customFields.filter(f=>f.is_active).length>=40){setError("Maximum 40 active custom fields.");return}
  const slug=label.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,35);
  const fieldKey=(slug||"field")+"_"+crypto.randomUUID().slice(0,8);
  setError("");setBusy(true);
  try{
   const {error:writeError}=await createClient().from("supplier_custom_fields").insert({
    organization_id:organizationId,field_key:fieldKey,label,
    field_type:newType,is_required:newRequired,sort_order:customFields.length+1
   });
   if(writeError)throw writeError;
   await reloadCustom();
   setNewName("");setNewRequired(false);setNewType("text");setAdding(false);
   notify("New supplier field added.");
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not add field.");}
  finally{setBusy(false)}
 }
 async function submitSupplier(){
  if(saving||busy)return;
  const standard:Record<SupplierBaseKey,string|null>={
   name:null,nic_or_registration:null,phone:null,address:null,bank_details:null,notes:null
  };
  const customValues:Record<string,string|number>={};
  for(const field of activeFields){
   const value=(values[field.key]??"").trim();
   if(field.required&&!value){setError(field.label+" is required.");return}
   if(field.key==="name"&&value.length>200){setError("Supplier Name is too long.");return}
   if(field.kind==="standard"){
    if(value.length>(field.key==="phone"?60:field.key==="name"?200:5000)){
     setError(field.label+" is too long.");return;
    }
    standard[standardKey(field.key)]=value||null;
   }else if(value){
    if(value.length>500){setError(field.label+" cannot exceed 500 characters.");return}
    if(field.type==="number"){
     const n=Number(value);if(!Number.isFinite(n)){setError(field.label+" must be a valid number.");return}
     customValues[field.key.slice(7)]=n;
    }else if(field.type==="date"){
     if(!dateValid(value)){setError(field.label+" must be a valid date.");return}
     customValues[field.key.slice(7)]=value;
    }else customValues[field.key.slice(7)]=value;
   }
  }
  setSaving(true);setError("");
  const {error:failure}=await createClient().from("suppliers").insert({
   ...standard,organization_id:organizationId,custom_values:customValues
  });
  setSaving(false);
  if(failure){setError(failure.message);notify(failure.message,"error");return}
  notify("Supplier created successfully.");
  router.push("/dashboard/masters?tab=suppliers");
  router.refresh();
 }
 const fieldPlaceholder=(field:FieldItem)=>{
  if(field.type==="date")return "";
  if(field.type==="number")return "e.g. 2.5";
  const placeholders:Record<string,string>={
   name:"Enter supplier or business name",
   nic_or_registration:"NIC or business registration number",
   phone:"07X XXX XXXX",
   address:"Street, city, district",
   bank_details:"Bank name, account number and branch",
   notes:"Additional information about this supplier"
  };
  return placeholders[field.key]??"Enter "+field.label.toLocaleLowerCase();
 };
 function renderField(field:FieldItem){
  const isName=field.key==="name";
  const isEditing=editing===field.key;
  return <article key={field.key} className={"sc-field-row"+(isEditing?" sc-row-editing":"")}>
   <div className="sc-tile-heading">
    <div className="sc-tile-title"><label htmlFor={"field-"+field.key}>{field.label}{field.required&&<span className="sc-required-mark"> *</span>}</label><small>{field.kind==="standard"?"Standard":"Custom"} · {field.type}</small></div>
    <div className="sc-field-tools" role="group" aria-label={field.label+" controls"}>
    <button type="button" className={"sc-icon-button"+(isEditing?" selected":"")} title={"Edit "+field.label} aria-label={"Edit "+field.label}
     disabled={busy||saving} onClick={()=>beginEditing(field)}><Pencil size={17}/></button>
    <button type="button" className="sc-icon-button danger" title={isName?"Supplier Name cannot be removed":"Remove "+field.label} aria-label={"Remove "+field.label}
     disabled={isName||busy||saving} onClick={()=>{setEditing(null);setConfirmRemoval(field.key);setError("")}}><Trash2 size={17}/></button>
    <button type="button" className={"sc-icon-button required"+(field.required?" on":"")} aria-pressed={field.required}
     title={isName?"Supplier Name is always required":field.required?"Make optional":"Make required"}
     aria-label={(field.required?"Mark optional: ":"Mark required: ")+field.label}
     disabled={isName||busy||saving}
     onClick={()=>void saveField(field,{required:!field.required})}><Asterisk size={16}/></button>
    </div>
   </div>
   <div className="sc-field-main">
    {isEditing?<div className="sc-inline-editor">
      <label htmlFor={"edit-"+field.key}>Edit field label</label>
      <div className="sc-inline-editor-controls">
       <input id={"edit-"+field.key} autoFocus value={editLabel} maxLength={80} onChange={e=>setEditLabel(e.target.value)}/>
       <button type="button" className="sc-save-mini" disabled={busy} onClick={()=>void saveField(field,{label:editLabel})}><Check size={16}/> Save</button>
       <button type="button" className="sc-cancel-mini" onClick={()=>setEditing(null)} aria-label="Cancel editing"><X size={17}/></button>
      </div>
     </div>:<>
      {field.key==="notes"||field.key==="address"?
        <textarea id={"field-"+field.key} name={field.key} rows={field.key==="notes"?3:2} required={field.required} placeholder={fieldPlaceholder(field)} disabled={saving||busy}
         value={values[field.key]??""} onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}/>:
        <input id={"field-"+field.key} name={field.key} type={field.type==="number"?"number":field.type==="date"?"date":"text"}
         step={field.type==="number"?"any":undefined} required={field.required} disabled={saving||busy}
         maxLength={field.type==="text"?(field.key==="name"?200:field.key==="phone"?60:field.kind==="custom"?500:5000):undefined}
         placeholder={fieldPlaceholder(field)} value={values[field.key]??""}
         onChange={e=>setValues(v=>({...v,[field.key]:e.target.value}))}/>}
     </>}
     {confirmRemoval===field.key&&<div className="sc-inline-remove">
       <div><strong>Remove {field.label}?</strong><p>This field will disappear from new forms and Excel exports. Existing data stays safe.</p></div>
       <div className="sc-inline-remove-actions"><button type="button" className="sc-cancel-mini" disabled={busy} onClick={()=>setConfirmRemoval(null)}>Cancel</button><button type="button" className="sc-danger-button" disabled={busy} onClick={()=>void saveField(field,{active:false,required:false})}><Trash2 size={15}/> Remove</button></div>
      </div>}
   </div>
  </article>
 }
 return <div className="sc-page">
  <header className="sc-page-header">
   <div><span className="sc-eyebrow">SUPPLIER DIRECTORY</span><h1>Add a new supplier</h1><p>Enter supplier details and customize fields directly on this page.</p></div>
   <div className="sc-header-actions"><SupplierExcelManager importOnly organizationId={organizationId} fields={customFields} standardOverrides={standardOverrides}
    onFieldsChanged={reloadCustom} onStandardFieldsChanged={reloadStandard} onImported={async()=>{router.refresh()}}/>
    <Link href="/dashboard/masters?tab=suppliers" className="sc-back-link">Back to suppliers</Link></div>
  </header>
  <div className="sc-layout">
   <main className="sc-main-card">
    <div className="sc-card-intro"><div className="sc-card-intro-icon"><Users size={22}/></div><div><h2>Supplier information</h2><p>Use the controls beside a field to edit, remove, or mark it as required.</p></div></div>
    {error&&<div role="alert" className="sc-alert"><Info size={18}/><span>{error}</span><button type="button" onClick={()=>setError("")} aria-label="Dismiss error"><X size={16}/></button></div>}
    <form id="sc-new-supplier-form" onSubmit={e=>{e.preventDefault();void submitSupplier()}}>
      <div className="sc-control-legend"><span><Pencil size={14}/> Edit label</span><span><Trash2 size={14}/> Remove field</span><span><Asterisk size={14}/> Required</span></div>
      <div className="sc-fields">{activeFields.map(renderField)}
      <div className={"sc-add-section"+(adding?" expanded":"")}>
       {!adding?<button type="button" className="sc-add-more" onClick={()=>{setAdding(true);setError("");setEditing(null);setConfirmRemoval(null)}} disabled={busy||saving}><Plus size={17}/> Add More Field</button>:
        <div className="sc-add-inline">
         <div className="sc-add-inline-header"><div><Plus size={18}/><strong>New custom field</strong></div><button type="button" onClick={()=>setAdding(false)} aria-label="Cancel new field"><X size={17}/></button></div>
         <div className="sc-add-inline-grid">
          <label>Field name<input placeholder="e.g. Village, Land Size" value={newName} maxLength={80} onChange={e=>setNewName(e.target.value)}/></label>
          <label>Field type<select value={newType} onChange={e=>setNewType(e.target.value as "text"|"number"|"date")}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option></select></label>
          <button type="button" aria-pressed={newRequired} className={"sc-inline-required"+(newRequired?" on":"")} onClick={()=>setNewRequired(v=>!v)}><Asterisk size={17}/>{newRequired?"Required":"Optional"}</button>
          <button type="button" className="sc-add-confirm" disabled={busy||!newName.trim()} onClick={()=>void createCustomField()}><Check size={16}/> Add Field</button>
         </div>
         <p>Adding a field saves it for this business and includes it in future Excel templates.</p>
        </div>}
      </div>
      </div>
      {!!archivedFields.length&&<details className="sc-archived"><summary><RotateCcw size={16}/> Removed fields ({archivedFields.length}) <ChevronDown size={16}/></summary>
       <div className="sc-archived-rows">{archivedFields.map(f=><div key={f.key}><span><strong>{f.label}</strong><small>{f.type} · Data preserved</small></span><button type="button" disabled={busy||saving} onClick={()=>void saveField(f,{active:true})}><RotateCcw size={15}/> Restore</button></div>)}</div>
      </details>}
      <div className="sc-form-footer"><div><ShieldCheck size={18}/><span>Supplier details are saved to your business workspace.</span></div><div><Link href="/dashboard/masters?tab=suppliers" className="sc-form-cancel">Cancel</Link><button type="submit" className="sc-submit" disabled={busy||saving}><Save size={18}/>{saving?"Saving supplier…":"Save Supplier"}<ArrowRight size={17}/></button></div></div>
    </form>
   </main>
  </div>
 </div>;
}
