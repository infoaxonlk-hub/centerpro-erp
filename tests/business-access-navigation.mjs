import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const require=createRequire(import.meta.url),ts=require("typescript"),React=require("react");
const {renderToStaticMarkup}=require("react-dom/server");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
let mode="cards",group=null,pathname="/dashboard",stateIndex=0;
const mockReact={...React,useEffect(){},useRef:()=>({current:null}),useState(initial){
 const index=stateIndex++;let value=typeof initial==="function"?initial():initial;
 if(index===5)value=mode;if(index===6)value=group;
 return[value,()=>{}];
}};
const cache=new Map();
function load(filename){
 const full=path.resolve(root,filename);if(cache.has(full))return cache.get(full);
 const mod={exports:{}};cache.set(full,mod.exports);
 const compiled=ts.transpileModule(fs.readFileSync(full,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(compiled,{module:mod,exports:mod.exports,process:{env:{}},require(name){
  if(name.endsWith(".css"))return{};
  if(name==="react")return mockReact;
  if(name==="next/navigation")return{usePathname:()=>pathname,useRouter:()=>({push(){}})};
  if(name==="next/link")return{default:({children,href,...props})=>React.createElement("a",{...props,href},children),__esModule:true};
  if(name==="./offline-pos-link")return{OfflinePosLink:({children,href,...props})=>React.createElement("a",{...props,href},children)};
  if(name.startsWith("@/"))return load(name.slice(2)+".ts"+(name.includes("components/")?"x":""));
  if(name.startsWith("./"))return load(path.relative(root,path.resolve(path.dirname(full),name+".tsx")));
  return require(name);
 }});
 cache.set(full,mod.exports);return mod.exports;
}
const {AppearanceShell}=load("components/appearance-shell.tsx");
const {SidebarNavigation,canSeeNavigation}=load("components/sidebar-navigation.tsx");
const registry=load("lib/business-modules.ts");
for(const currentMode of ["cards","apps","list"]){
 mode=currentMode;group=null;stateIndex=0;pathname="/dashboard";
 const props={permissions:["dashboard"],isAdmin:true,enabledModules:["dashboard"],companyName:"Test business",isSuperAdmin:true};
 const element=React.createElement(AppearanceShell,props,React.createElement(SidebarNavigation,props));
 const html=renderToStaticMarkup(element);
 assert.match(html,/Sales/);assert.match(html,/Purchases/);assert.match(html,/Module Access Restricted|Locked/);
 assert.match(html,/href="\/dashboard\/restricted\?module=sales"/);
 assert.match(html,/href="\/dashboard\/businesses"/);
 assert.ok(html.includes("<svg"),"Normal module icons must remain visible");
 console.log("PASS locked module visibility and restricted destinations in "+currentMode+" navigation");
}
stateIndex=0;mode="cards";group="/dashboard/stock";pathname="/dashboard";
const nested=renderToStaticMarkup(React.createElement(AppearanceShell,{permissions:["dashboard","stock"],isAdmin:true,enabledModules:["dashboard","inventory"]},null));
assert.match(nested,/Internal transfers/);assert.match(nested,/restricted\?module=stock_transfers/);
assert.equal(canSeeNavigation({href:"/dashboard/sales",permission:"sales"},["dashboard"],true,["dashboard","sales"]),false);
assert.equal(canSeeNavigation({href:"/dashboard/sales",permission:"sales"},["dashboard"],true,["dashboard"]),true);
console.log("PASS nested modules remain locked; enabled modules still require existing user permissions");
for(const item of registry.businessModules){
 assert.equal(registry.moduleForPath(item.href),item.key);
 if("parent" in item)assert.equal(registry.moduleEnabled(item.key,["dashboard",item.key]),false);
}
const read=filename=>fs.readFileSync(path.resolve(root,filename),"utf8");
const schema=read("supabase/migrations/045_business_access_schema.sql");
for(const key of registry.moduleKeys)assert.ok(schema.includes("'"+key+"'"),"DB catalogue must contain "+key);
assert.match(read("app/dashboard/restricted/page.tsx"),/Module Access Restricted/);
assert.match(read("app/dashboard/restricted/page.tsx"),/This module is not available for your business\. Please contact InfoAxon to enable access\./);
assert.match(read("components/support-contact.tsx"),/INFOAXON_SUPPORT_URL/);
assert.ok(!read("public/service-worker.js").includes("cache.put(url.pathname"),"Private operational HTML must not be cached");
console.log("PASS module catalogue, parent requirements, restricted message, support configuration and safe caching");
