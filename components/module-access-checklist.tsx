"use client";
import { businessModules, moduleKeys, normalizeModules, type BusinessModuleKey } from "@/lib/business-modules";
export function ModuleAccessChecklist({value,onChange,disabled=false}:{value:BusinessModuleKey[];onChange:(value:BusinessModuleKey[])=>void;disabled?:boolean}) {
 function toggle(key:BusinessModuleKey,enabled:boolean) {
   if(enabled) onChange(normalizeModules([...value,key]));
   else {
     const removed = new Set<string>([key]);
     for(const item of businessModules) if("parent" in item && removed.has(item.parent)) removed.add(item.key);
     onChange(value.filter(k=>!removed.has(k)));
   }
 }
 return <section className="business-modules"><div className="business-section-heading"><div><h3>Module Access</h3><p>{value.length} of {moduleKeys.length} modules enabled</p></div>
   <div className="business-buttons"><button className="ghost" type="button" disabled={disabled} onClick={()=>onChange([...moduleKeys])}>Enable all</button>
   <button className="ghost" type="button" disabled={disabled} onClick={()=>onChange(["dashboard"])}>Disable optional modules</button></div></div>
   <div className="business-module-grid">{businessModules.map(module=><label key={module.key}>
     <input type="checkbox" checked={value.includes(module.key)} disabled={disabled||("required" in module && module.required)}
       onChange={event=>toggle(module.key,event.target.checked)}/>
     <span>{module.name}{"required" in module&&<small>Required core</small>}{"parent" in module&&<small>Requires {businessModules.find(m=>m.key===module.parent)?.name}</small>}</span>
   </label>)}</div></section>;
}
