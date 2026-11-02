"use client";

import {useRef,useState} from "react";
import {Archive,Check,CheckCircle2,ChevronLeft,Download,FileSpreadsheet,Layers3,Pencil,Plus,RotateCcw,Settings2,ShieldCheck,Upload,X} from "lucide-react";
import {createClient} from "@/lib/supabase/client";
import {effectiveSupplierBaseFields,type StandardSupplierOverride,type SupplierBaseKey} from "@/lib/supplier-field-config";
import {notify} from "@/components/feedback";
import {loadCompatibleSupplierWorkbook} from "@/lib/supplier-excel-compat";
import "./supplier-excel.css";

export type SupplierField = {id:string;field_key:string;label:string;field_type:"text"|"number"|"date";is_required:boolean;is_active:boolean;sort_order:number};
type ImportRow = {name:string;nic_or_registration:string|null;phone:string|null;address:string|null;bank_details:string|null;notes:string|null;custom_values:Record<string,string|number>;import_token:string};
type Editor = {kind:"standard"|"custom";key:string};
const toHex=(input:ArrayBuffer)=>Array.from(new Uint8Array(input),v=>v.toString(16).padStart(2,"0")).join("");
function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+"T00:00:00Z");return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value;}
function cellText(cell:{value:unknown;text:string},row:number){
 const v=cell.value;
 if(v&&typeof v==="object"&&!(v instanceof Date))throw new Error("Row "+row+": formulas and rich cells are not supported. Paste plain values.");
 return v instanceof Date?v.toISOString().slice(0,10):cell.text.trim();
}
function downloadXlsx(bytes:BlobPart){
 const objectUrl=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
 const a=document.createElement("a");a.href=objectUrl;a.download="centerpro-supplier-template.xlsx";document.body.append(a);a.click();a.remove();
 window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
}
export function SupplierExcelManager({organizationId,fields,standardOverrides,onFieldsChanged,onStandardFieldsChanged,onImported,importOnly=false}:{
 organizationId:string;fields:SupplierField[];standardOverrides:StandardSupplierOverride[];
 onFieldsChanged:()=>Promise<void>;onStandardFieldsChanged:()=>Promise<void>;onImported:()=>Promise<void>;importOnly?:boolean;
}){
 const [open,setOpen]=useState<"fields"|"import"|null>(null);
 const [newLabel,setNewLabel]=useState(""),[newType,setNewType]=useState<SupplierField["field_type"]>("text"),[newRequired,setNewRequired]=useState(false);
 const [editor,setEditor]=useState<Editor|null>(null),[confirmRemove,setConfirmRemove]=useState<Editor|null>(null),[editLabel,setEditLabel]=useState(""),[editRequired,setEditRequired]=useState(false),[editActive,setEditActive]=useState(true);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[rows,setRows]=useState<ImportRow[]>([]),[filename,setFilename]=useState("");
 const [progress,setProgress]=useState({done:0,imported:0,skipped:0});const stop=useRef(false);
 const fileInputRef=useRef<HTMLInputElement|null>(null);
 function clearSelectedFile(){
  if(busy)return;
  setRows([]);setFilename("");setError("");setProgress({done:0,imported:0,skipped:0});
  if(fileInputRef.current)fileInputRef.current.value="";
 }
 const standard=effectiveSupplierBaseFields(standardOverrides);
 const enabledStandard=standard.filter(f=>f.active);
 const sortedCustom=[...fields].sort((a,b)=>a.sort_order-b.sort_order);
 const activeCustom=sortedCustom.filter(f=>f.is_active);
 const allLabels=[...standard.filter(f=>f.active).map(f=>f.label.toLowerCase()),...activeCustom.map(f=>f.label.toLowerCase())];
 const selected=editor?.kind==="standard"?standard.find(f=>f.key===editor.key):editor?fields.find(f=>f.field_key===editor.key):null;
 const selectedType=selected?("type" in selected?selected.type:selected.field_type):"text";
 const selectedNameIsCore=editor?.kind==="standard"&&editor.key==="name";
 function startEdit(kind:Editor["kind"],key:string){
  const field=kind==="standard"?standard.find(f=>f.key===key):fields.find(f=>f.field_key===key);
  if(!field)return;setEditor({kind,key});setError("");setEditLabel(field.label);
  setEditRequired("required" in field?field.required:field.is_required);
  setEditActive("active" in field?field.active:field.is_active);
 }
 function close(){if(!busy){setOpen(null);setEditor(null);setConfirmRemove(null);setError("")}}
 async function createField(){
  const clean=newLabel.trim();setError("");
  if(!clean||clean.length>80){setError("Field name must contain 1–80 characters.");return}
  if(allLabels.includes(clean.toLowerCase())){setError("Another active field already has this name.");return}
  if(activeCustom.length>=40){setError("Maximum 40 active custom fields.");return}
  const key=(clean.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,35)||"field")+"_"+crypto.randomUUID().slice(0,8);
  setBusy(true);
  try{
   const {error:failure}=await createClient().from("supplier_custom_fields").insert({organization_id:organizationId,field_key:key,label:clean,field_type:newType,is_required:newRequired,sort_order:fields.length+1});
   if(failure)throw failure;
   setNewLabel("");setNewRequired(false);await onFieldsChanged();notify("Custom supplier field added.");
  }catch(e){setError(e instanceof Error?e.message:"Could not create field.")}finally{setBusy(false)}
 }
 async function updateField(kind:Editor["kind"],key:string,values:{label:string;required:boolean;active:boolean}){
  const clean=values.label.trim();setError("");
  if(!clean||clean.length>80){setError("Field name must contain 1–80 characters.");return false}
  const duplicate=standard.some(f=>f.active&&!(kind==="standard"&&f.key===key)&&f.label.toLowerCase()===clean.toLowerCase()) || activeCustom.some(f=>!(kind==="custom"&&f.field_key===key)&&f.label.toLowerCase()===clean.toLowerCase());
  if(values.active&&duplicate){setError("Another active field already has this name.");return false}
  if(key==="name"&&kind==="standard"&&(!values.active||!values.required)){setError("Supplier Name must remain visible and required.");return false}
  if(!values.active)values.required=false;
  setBusy(true);
  try {
   const sb=createClient();
   if(kind==="standard"){
    const {error:failure}=await sb.from("supplier_standard_fields").upsert({organization_id:organizationId,field_key:key,label:clean,is_required:values.required,is_active:values.active},{onConflict:"organization_id,field_key"});
    if(failure)throw failure;
    await onStandardFieldsChanged();
   }else{
    const current=fields.find(f=>f.field_key===key);
    if(!current)throw new Error("Field not found.");
    const {error:failure}=await sb.from("supplier_custom_fields").update({label:clean,is_required:values.required,is_active:values.active}).eq("organization_id",organizationId).eq("id",current.id);
    if(failure)throw failure;
    await onFieldsChanged();
   }
   setEditor(null);setConfirmRemove(null);notify(values.active?"Supplier field settings saved.":"Supplier field removed from forms and templates; existing data retained.");
   return true;
  }catch(e){setError(e instanceof Error?e.message:"Could not update field.");return false}
  finally{setBusy(false)}
 }
 async function archiveField(kind:Editor["kind"],key:string,active:boolean){
  const current=kind==="standard"?standard.find(f=>f.key===key):fields.find(f=>f.field_key===key);
  if(!current)return;
  if(!active){setConfirmRemove({kind,key});setError("");return}
  await updateField(kind,key,{label:current.label,required:"required" in current?current.required:current.is_required,active:true});
 }
 async function exportTemplate(){
  setBusy(true);setError("");
  try{
   const ExcelJS=(await import("exceljs")).default;const wb=new ExcelJS.Workbook();wb.creator="CenterPro ERP";
   const data=wb.addWorksheet("Suppliers"),meta=wb.addWorksheet("_CenterProFields"),info=wb.addWorksheet("Instructions");
   const columns=[...enabledStandard.map(f=>({key:f.key,label:f.label,type:f.type,required:f.required})),...activeCustom.map(f=>({key:"custom:"+f.field_key,label:f.label,type:f.field_type,required:f.is_required}))];
   meta.getCell(1,1).value="CENTERPRO_SUPPLIERS_V1";
   for(const [index,field] of columns.entries()){
    const i=index+1,header=field.label+(field.required?" *":"");
    data.getCell(1,i).value=header;data.getColumn(i).width=Math.min(42,Math.max(20,field.label.length+7));data.getColumn(i).numFmt="@";
    meta.getCell(2,i).value=field.key;meta.getCell(3,i).value=header;meta.getCell(4,i).value=field.type;
   }
   data.getRow(1).height=32;data.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
   data.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF3B2A63"}};
   data.views=[{state:"frozen",ySplit:1}];data.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
   info.getColumn(1).width=110;
   ["CENTERPRO / SUPPLIER EXCEL IMPORT","Enter data on the Suppliers sheet starting from row 2.","Only active fields are included. Supplier Name is always required.","Headers marked with * are required. Do not rename the headers or modify hidden metadata.","Keep phone and NIC values as text to preserve leading zeroes.","Custom date format: YYYY-MM-DD; number fields require numeric values.","Maximum 1,000 suppliers per file. Empty rows are ignored.","Keep the same workbook to retry failed imports without duplicates.","If required fields change, download a new template."].forEach(line=>info.addRow([line]));
   meta.state="veryHidden";
   downloadXlsx(await wb.xlsx.writeBuffer() as BlobPart);notify("Supplier Excel template downloaded.");
  }catch(e){setError(e instanceof Error?e.message:"Unable to export Excel template.")}
  finally{setBusy(false)}
 }
 async function chooseFile(file?:File){
  setRows([]);setFilename(file?.name??"");setError("");setProgress({done:0,imported:0,skipped:0});
  if(!file)return;
  if(!file.name.toLowerCase().endsWith(".xlsx")||file.size>8*1024*1024){setError("Select an .xlsx workbook up to 8 MB.");return}
  setBusy(true);
  try{
   const bytes=await file.arrayBuffer();
   const wb=await loadCompatibleSupplierWorkbook(bytes);
   const sheet=wb.getWorksheet("Suppliers"),meta=wb.getWorksheet("_CenterProFields");
   if(!sheet||!meta||meta.getCell(1,1).text!=="CENTERPRO_SUPPLIERS_V1")throw new Error("Not a CenterPro template. Download a fresh template.");
   const count=meta.getRow(2).cellCount;
   if(count<1||count>46||sheet.rowCount>10010)throw new Error("Invalid template size or columns.");
   const valid=new Map<string,{label:string;required:boolean;type:string}>([
    ...enabledStandard.map(f=>[f.key,{label:f.label,required:f.required,type:f.type}] as const),
    ...activeCustom.map(f=>["custom:"+f.field_key,{label:f.label,required:f.is_required,type:f.field_type}] as const)
   ]);
   const keys:string[]=[];const seen=new Set<string>();
   for(let c=1;c<=count;c++){
    const key=meta.getCell(2,c).text.trim(),label=meta.getCell(3,c).text.trim();
    if(!valid.has(key))throw new Error("A field was removed or is no longer active: "+key+". Export a new template.");
    if(seen.has(key))throw new Error("Duplicate column: "+key);
    if(label!==sheet.getCell(1,c).text.trim())throw new Error("Column "+c+" header was changed. Restore exported headers.");
    seen.add(key);keys.push(key);
   }
   if(!seen.has("name"))throw new Error("Supplier Name column is missing.");
   for(const [key,field] of valid)if(field.required&&!seen.has(key))throw new Error("New required field "+field.label+" is missing. Export a fresh template.");
   const hash=toHex(await crypto.subtle.digest("SHA-256",bytes));
   const parsed:ImportRow[]=[];const duplicates=new Set<string>();
   for(let line=2;line<=sheet.rowCount;line++){
    const values=keys.map((_,col)=>cellText(sheet.getCell(line,col+1),line));
    if(values.every(v=>!v))continue;
    if(parsed.length>=1000)throw new Error("Maximum 1,000 suppliers per workbook.");
    const item:ImportRow={name:"",nic_or_registration:null,phone:null,address:null,bank_details:null,notes:null,custom_values:{},import_token:hash.slice(0,56)+line.toString(16).padStart(8,"0")};
    for(const [col,key] of keys.entries()){
     const text=values[col],field=valid.get(key)!;
     if(field.required&&!text)throw new Error("Row "+line+": "+field.label+" is required.");
     if(key.startsWith("custom:")){
      if(text.length>500)throw new Error("Row "+line+": "+field.label+" is too long.");
      if(!text)continue;
      if(field.type==="number"){
       const n=Number(text);if(!Number.isFinite(n))throw new Error("Row "+line+": "+field.label+" must be a number.");
       item.custom_values[key.slice(7)]=n;
      }else if(field.type==="date"){
       if(!validDate(text))throw new Error("Row "+line+": "+field.label+" must be YYYY-MM-DD.");
       item.custom_values[key.slice(7)]=text;
      }else item.custom_values[key.slice(7)]=text;
     }else{
      const max=key==="name"?200:key==="phone"?60:5000;
      if(text.length>max)throw new Error("Row "+line+": "+field.label+" is too long.");
      if(key==="name")item.name=text;
      else item[key as Exclude<SupplierBaseKey,"name">]=text||null;
     }
    }
    if(!item.name)throw new Error("Row "+line+": Supplier Name is required.");
    const identity=[item.name,item.nic_or_registration??"",item.phone??""].join("|").toLowerCase();
    if(duplicates.has(identity))throw new Error("Row "+line+": duplicate supplier name/NIC/phone within this workbook.");
    duplicates.add(identity);parsed.push(item);
    if(line%200===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
   }
   if(!parsed.length)throw new Error("No supplier rows found.");
   setRows(parsed);
  }catch(e){setError(e instanceof Error?e.message:"Could not open this workbook.");setRows([])}
  finally{setBusy(false)}
 }
 async function importRows(){
  if(!rows.length||busy)return;
  setBusy(true);setError("");stop.current=false;
  let imported=0,skipped=0,done=0;
  try{
   for(let index=0;index<rows.length;index+=100){
    if(stop.current)break;
    const batch=rows.slice(index,index+100);
    const response=await fetch("/api/suppliers/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows:batch})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"Import failed at row "+(index+2));
    imported+=result.imported;skipped+=result.skipped;done+=batch.length;
    setProgress({done,imported,skipped});
    await new Promise<void>(resolve=>setTimeout(resolve,0));
   }
   await onImported();
   notify(imported+" suppliers imported. "+skipped+" already processed.");
   if(done===rows.length){setRows([]);setFilename("");if(fileInputRef.current)fileInputRef.current.value=""}
  }catch(e){
   setError((e instanceof Error?e.message:"Import failed")+" — "+done+" of "+rows.length+" processed. Retry the same workbook safely.");
   await onImported();
  }finally{setBusy(false);stop.current=false}
 }
 function fieldRow(field:{key:string;label:string;type:string;required:boolean;active:boolean},kind:Editor["kind"],canRemove=true){
  return <article className={"sf-field-row"+(field.active?"":" sf-field-row-inactive")} key={kind+field.key}>
   <div className="sf-field-symbol">{kind==="standard"?<Layers3 size={18}/>:<Settings2 size={18}/>}</div>
   <div className="sf-field-ident"><strong>{field.label}</strong><div className="sf-tags"><span>{field.type}</span><span>{field.required?"Required":"Optional"}</span>{!field.active&&<span className="sf-tag-archived">Removed</span>}</div></div>
   <div className="sf-field-actions">
    <button type="button" className="sf-icon-action" onClick={()=>startEdit(kind,field.key)} aria-label={"Edit "+field.label} title="Edit field"><Pencil size={17}/></button>
    {canRemove?<button type="button" className="sf-icon-action" disabled={busy} aria-label={(field.active?"Remove ":"Restore ")+field.label} title={field.active?"Remove from forms and templates":"Restore field"} onClick={()=>void archiveField(kind,field.key,!field.active)}>{field.active?<Archive size={17}/>:<RotateCcw size={17}/>}</button>:<span className="sf-locked" title="Supplier Name must remain enabled"><ShieldCheck size={17}/></span>}
   </div>
  </article>
 }
 return <>
  <div className="supplier-excel-buttons">
   {!importOnly&&<button className="soft supplier-toolbar-button" type="button" onClick={()=>{setOpen("fields");setError("");setEditor(null)}}><Settings2 size={16}/> Add / Edit Fields</button>}
   <button className="soft supplier-toolbar-button" type="button" onClick={()=>{setOpen("import");setError("");setRows([]);setFilename("");setProgress({done:0,imported:0,skipped:0});setEditor(null)}}><FileSpreadsheet size={16}/> Export / Import Excel</button>
  </div>
  {open&&<div className="dialog-backdrop sf-backdrop"><section className="sf-modal" role="dialog" aria-modal="true" aria-label={open==="fields"?"Manage Supplier Fields":"Import Suppliers"}>
   <header className="sf-modal-header">
    <div className="sf-modal-title-icon">{open==="fields"?<Settings2 size={21}/>:<FileSpreadsheet size={21}/>}</div>
    <div className="sf-heading"><span className="sf-kicker">SUPPLIER MANAGEMENT</span><h2>{open==="fields"?"Manage Supplier Fields":"Excel Supplier Import"}</h2><p>{open==="fields"?"Customize the fields used in new suppliers and Excel templates.":"Import up to 1,000 suppliers using a template tailored to your business."}</p></div>
    <button className="sf-close" onClick={close} disabled={busy} aria-label="Close"><X size={19}/></button>
   </header>
   <div className="sf-modal-body">
    {error&&<div className="alert error" role="alert">{error}</div>}
    {open==="fields"?(confirmRemove? <div className="sf-confirm-screen"><div className="sf-confirm-icon"><Archive size={25}/></div><h3>Remove this field?</h3><p><strong>{confirmRemove.kind==="standard"?standard.find(f=>f.key===confirmRemove.key)?.label:fields.find(f=>f.field_key===confirmRemove.key)?.label}</strong> will be hidden from new supplier forms and future Excel templates. Existing values will stay safely in the database. You can restore the field later.</p><div className="sf-confirm-actions"><button className="ghost" type="button" disabled={busy} onClick={()=>setConfirmRemove(null)}>Keep field</button><button className="sf-danger-action" type="button" disabled={busy} onClick={()=>{const field=confirmRemove.kind==="standard"?standard.find(f=>f.key===confirmRemove.key):fields.find(f=>f.field_key===confirmRemove.key);if(field)void updateField(confirmRemove.kind,confirmRemove.key,{label:field.label,required:false,active:false})}}><Archive size={16}/> Remove field</button></div></div> : editor&&selected?<>
      <button className="sf-back-link" type="button" onClick={()=>{setEditor(null);setError("")}}><ChevronLeft size={17}/> Back to all fields</button>
      <div className="sf-edit-header"><div className="sf-field-symbol sf-edit-symbol"><Pencil size={20}/></div><div><h3>Edit {selected.label}</h3><p>{editor.kind==="standard"?"Built-in field · Storage key stays unchanged":"Custom field · Data type stays unchanged"}</p></div></div>
      <div className="sf-editor">
       <label className="sf-form-label">Display name<input autoFocus value={editLabel} maxLength={80} onChange={e=>setEditLabel(e.target.value)}/></label>
       <div className="sf-editor-type"><span>Field type</span><strong>{selectedType}</strong></div>
       <fieldset className="sf-choice-field"><legend>Required when adding a supplier</legend><div className="sf-choice-row"><button type="button" disabled={selectedNameIsCore} aria-pressed={!editRequired} className={!editRequired?"selected":""} onClick={()=>setEditRequired(false)}>Optional</button><button type="button" disabled={selectedNameIsCore} aria-pressed={editRequired} className={editRequired?"selected":""} onClick={()=>setEditRequired(true)}><Check size={15}/> Required</button></div></fieldset>
       <fieldset className="sf-choice-field"><legend>Visibility in new forms and Excel exports</legend><div className="sf-choice-row"><button type="button" aria-pressed={editActive} className={editActive?"selected":""} onClick={()=>setEditActive(true)}><CheckCircle2 size={15}/> Active</button><button type="button" disabled={selectedNameIsCore} aria-pressed={!editActive} className={!editActive?"selected":""} onClick={()=>{setEditActive(false);setEditRequired(false)}}><Archive size={15}/> Removed</button></div></fieldset>
       <p className="sf-explanation">{selectedNameIsCore?"Supplier Name is required for identifying each supplier and cannot be removed. Its display name can be changed.":"Removing a field hides it from new forms and Excel exports. Historical supplier values remain safely stored."}</p>
      </div>
      <div className="sf-editor-actions"><button type="button" className="ghost" onClick={()=>setEditor(null)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={()=>void updateField(editor.kind,editor.key,{label:editLabel,required:editRequired,active:editActive})}><Check size={16}/> Save changes</button></div>
    </>:<>
      <div className="sf-section-heading"><div><span className="sf-section-eyebrow">CORE DETAILS</span><h3>Standard fields</h3><p>Rename, change requirement or remove fields. Supplier Name remains required.</p></div><span className="sf-count">{standard.filter(f=>f.active).length} active</span></div>
      <div className="sf-list">{standard.map(f=>fieldRow(f,"standard",f.key!=="name"))}</div>
      <div className="sf-section-heading sf-section-split"><div><span className="sf-section-eyebrow">YOUR BUSINESS</span><h3>Custom fields</h3><p>Additional fields tailored to your supplier records.</p></div><span className="sf-count">{activeCustom.length} active</span></div>
      <div className="sf-new-field">
       <div className="sf-new-heading"><Plus size={17}/><strong>Add new field</strong></div>
       <div className="sf-new-grid">
        <label className="sf-form-label">Field name<input value={newLabel} onChange={e=>setNewLabel(e.target.value)} maxLength={80} placeholder="e.g. Village, Land size"/></label>
        <label className="sf-form-label">Type<select value={newType} onChange={e=>setNewType(e.target.value as SupplierField["field_type"])}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option></select></label>
        <div className="sf-required-toggle"><span>Required?</span><div className="sf-choice-row"><button type="button" className={!newRequired?"selected":""} aria-pressed={!newRequired} onClick={()=>setNewRequired(false)}>No</button><button type="button" className={newRequired?"selected":""} aria-pressed={newRequired} onClick={()=>setNewRequired(true)}>Yes</button></div></div>
        <button type="button" className="primary sf-create" disabled={busy||!newLabel.trim()} onClick={()=>void createField()}><Plus size={16}/> Add field</button>
       </div>
      </div>
      <div className="sf-list sf-custom-list">{sortedCustom.map(f=>fieldRow({key:f.field_key,label:f.label,type:f.field_type,required:f.is_required,active:f.is_active},"custom"))}{!fields.length&&<div className="sf-empty">No custom fields yet. Use the form above to add your first field.</div>}</div>
    </>):<>
      <div className="sf-import-steps"><span>01 <strong>Configure</strong></span><span>02 <strong>Export</strong></span><span>03 <strong>Fill Excel</strong></span><span>04 <strong>Import</strong></span></div>
      <div className="sf-import-picker"><div><h3>Download your template</h3><p>Includes {enabledStandard.length} active standard and {activeCustom.length} custom fields.</p></div><button type="button" className="primary" disabled={busy} onClick={()=>void exportTemplate()}><Download size={17}/> Export Excel template</button></div>
      <label className="sf-upload"><Upload size={22}/><strong>Select completed Excel file</strong><small>Excel .xlsx · up to 8 MB · 1,000 suppliers</small><input ref={fileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={e=>{void chooseFile(e.target.files?.[0]);e.target.value=""}}/></label>
      {filename&&<div className="sf-selected-file"><div className="sf-selected-file-name"><FileSpreadsheet size={17}/><span title={filename}>{filename}</span></div><button className="sf-remove-file" type="button" disabled={busy} onClick={clearSelectedFile} aria-label="Remove selected Excel file" title="Remove selected file"><X size={16}/> Remove file</button></div>}
      {!!rows.length&&<><div className="sf-preview-title"><strong>{rows.length.toLocaleString()} validated suppliers</strong><span>First 8 rows shown</span></div><div className="sf-preview"><table><thead><tr><th>Supplier</th><th>NIC / BR</th><th>Phone</th><th>Custom fields</th></tr></thead><tbody>{rows.slice(0,8).map(r=><tr key={r.import_token}><td>{r.name}</td><td>{r.nic_or_registration??"—"}</td><td>{r.phone??"—"}</td><td>{Object.keys(r.custom_values).length}</td></tr>)}</tbody></table></div></>}
      {progress.done>0&&<div className="sf-progress"><div className="sf-progress-track"><span style={{width:(progress.done/Math.max(rows.length,progress.done)*100)+"%"}}/></div><p>{progress.done} processed · {progress.imported} created · {progress.skipped} already imported</p></div>}
      {busy&&rows.length>0&&<button type="button" className="ghost" onClick={()=>{stop.current=true}}>Stop after current batch</button>}
      <p className="sf-explanation">Only active fields are included. Headers and metadata must remain unchanged. The same unchanged Excel file can be retried safely.</p>
    </>}
   </div>
   <footer className="sf-footer"><span><ShieldCheck size={15}/> Changes apply only to this business</span><div><button type="button" className="ghost" disabled={busy} onClick={close}>Close</button>{open==="import"&&<button type="button" className="primary" disabled={busy||!rows.length} onClick={()=>void importRows()}><Upload size={16}/>{busy?"Importing…":"Import "+rows.length.toLocaleString()+" suppliers"}</button>}</div></footer>
  </section></div>}
 </>;
}
