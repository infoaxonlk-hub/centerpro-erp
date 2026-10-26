import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import vm from "node:vm";
const require=createRequire(import.meta.url),ts=require("typescript");
const root=path.resolve(new URL("..",import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1"));
const {randomUUID}=require("node:crypto");
const userId=randomUUID(),orgId=randomUUID(),targetId=randomUUID(),newUserId=randomUUID();
const subscription={plan:"Custom",status:"active",starts_on:"2020-01-01",expires_on:null,trial_ends_on:null,admin_notes:"Platform note"};
const record={id:targetId,name:"Business B",business_status:"active",receipt_address:"",receipt_phone:"",receipt_email:"",created_at:"2020-01-01T00:00:00Z",profiles:[],business_subscriptions:subscription,business_module_entitlements:[{module_key:"dashboard",enabled:true}]};
let state;
const redirects=[];
function reset(overrides={}){state={user:{id:userId},profile:{id:userId,organization_id:orgId,full_name:"Tester",role:"super_admin",is_active:true,permissions:["dashboard","users"]},business:{organizationId:orgId,businessName:"Own",businessStatus:"active",operational:true,enabledModules:["dashboard","users"],subscription},calls:[],rpcError:false,authError:false,missing:false,path:"/dashboard",...overrides};redirects.length=0;}
function query(table){
 const call={table,select:null,filters:[],op:"select"};state.calls.push(call);
 const q={select(value){call.select=value;return q;},order(){return q;},range(){return q;},limit(){return q;},
  eq(key,value){call.filters.push([key,value]);return q;},in(key,value){call.filters.push([key,value]);return q;},
  insert(value){call.op="insert";call.value=value;return q;},delete(){call.op="delete";return q;},update(value){call.op="update";call.value=value;return q;},
  async single(){return{data:state.missing?null:record,error:state.missing?{code:"PGRST116"}:null};},
  then(resolve,reject){return Promise.resolve({data:table==="organizations"?[record]:[],error:null,count:0}).then(resolve,reject);}
 };return q;
}
const service={from:query,async rpc(name,args){state.calls.push({rpc:name,args});return{data:state.rpcError?null:targetId,error:state.rpcError?{message:"sensitive database detail"}:null};},auth:{admin:{
 async createUser(value){state.calls.push({op:"createAuth",value});return{data:{user:state.authError?null:{id:newUserId}},error:state.authError?{message:"Internal Auth error"}:null};},
 async deleteUser(id){state.calls.push({op:"deleteAuth",id});return{error:null};}
}}};
const client={auth:{async getUser(){return{data:{user:state.user}};}},from(){return{select(){return{eq(){return{async single(){return{data:state.profile,error:null};}};}};}};},async rpc(name){assert.equal(name,"current_business_access");return{data:state.business,error:null};}};
const cache=new Map();
function load(filename){
 const full=path.resolve(root,filename);
 if(cache.has(full))return cache.get(full);
 const mod={exports:{}};cache.set(full,mod.exports);
 const compiled=ts.transpileModule(fs.readFileSync(full,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(compiled,{module:mod,exports:mod.exports,Response,Request,URL,console:{...console,error(){}},process:{env:{}},
 require(name){
  if(name==="@/lib/supabase/server")return{createClient:async()=>client};
  if(name==="@/lib/supabase/admin")return{createAdminClient:()=>{state.calls.push({op:"serviceClient"});return service;}};
  if(name==="next/navigation")return{redirect:href=>{redirects.push(href);throw new Error("REDIRECT:"+href);}};
  if(name==="next/headers")return{headers:async()=>({get:()=>state.path})};
  if(name.startsWith("@/"))return load(name.slice(2)+".ts");
  return require(name);
 }},{filename:full});
 cache.set(full,mod.exports);return mod.exports;
}
const list=load("app/api/admin/businesses/route.ts");
const detail=load("app/api/admin/businesses/[id]/route.ts");
const inspection=load("app/api/admin/businesses/[id]/workspace/route.ts");
const access=load("lib/access.ts");
const registry=load("lib/business-modules.ts");
const input={details:{name:"Business B",status:"active",address:"",phone:"",email:""},subscription,modules:["dashboard","purchases"],adminName:"Admin B",adminEmail:"b@example.test",password:"a-valid-password"};
const request=(body=input,method="POST")=>new Request("http://localhost/api/admin/businesses",{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const context={params:Promise.resolve({id:targetId})};
for(const override of [{user:null},{profile:{...{id:userId,organization_id:orgId,permissions:["users"]},role:"admin",is_active:true}},{profile:{id:userId,role:"super_admin",is_active:false}}]){
 reset(override);const expected=override.user===null?401:403;
 for(const response of [
  await list.GET(),await list.POST(request()),await detail.GET(new Request("http://localhost"),context),
  await detail.PATCH(request(input,"PATCH"),context),
  await inspection.GET(new Request("http://localhost?section=sales"),context)
 ])assert.equal(response.status,expected);
 assert.equal(state.calls.length,0);
}
console.log("PASS every management and inspection endpoint authenticates and rejects ordinary/inactive admins before service access");
reset();
assert.equal((await list.POST(request({...input,modules:["unknown"]}))).status,400);
assert.equal(state.calls.length,0);
assert.equal((await list.POST(request({...input,password:"x"}))).status,400);
reset();
const created=await list.POST(request());
assert.equal(created.status,201);
const payload=await created.json();
assert.equal(payload.id,targetId);
assert.ok(!JSON.stringify(payload).includes(input.password));
const rpc=state.calls.find(c=>c.rpc==="platform_provision_business").args;
assert.equal(rpc.p_actor,userId);assert.equal(rpc.p_admin,newUserId);
assert.deepEqual([...rpc.p_modules],["dashboard","purchases"]);
assert.ok(!rpc.p_permissions.includes("stock"));
console.log("PASS creation scopes the admin and selected entitlements without exposing passwords or assigning unrelated permissions");
reset({rpcError:true});
const failure=await list.POST(request());
assert.equal(failure.status,500);
assert.ok(!JSON.stringify(await failure.json()).includes("sensitive"));
assert.ok(state.calls.some(c=>c.op==="deleteAuth"&&c.id===newUserId));
reset({authError:true});assert.equal((await list.POST(request())).status,400);assert.ok(!state.calls.some(c=>c.rpc));
console.log("PASS failed atomic provisioning compensates Auth and sanitizes errors");
reset();
assert.equal((await detail.PATCH(request({...input,details:{...input.details,status:"suspended"},p_actor:"attacker",organizationId:orgId},"PATCH"),context)).status,200);
const save=state.calls.find(c=>c.rpc==="platform_save_business").args;
assert.equal(save.p_org,targetId);assert.equal(save.p_actor,userId);assert.equal(save.p_details.status,"suspended");
reset({missing:true});assert.equal((await detail.GET(new Request("http://localhost"),context)).status,404);
reset({business:{operational:false,enabledModules:[],reason:"suspended"}});
assert.equal((await list.GET()).status,200);
console.log("PASS edit uses route business ID and verified actor; platform management survives suspension of the super admin's home business");
reset();
for(const section of Object.keys(load("lib/business-inspection.ts").inspectionSections)){
 const response=await inspection.GET(new Request("http://localhost?section="+section),context);
 assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.readOnly,true);
}
for(const call of state.calls.filter(c=>c.table&&c.op==="select")){
 assert.ok(call.filters.some(([column,value])=>column==="organization_id"&&value===targetId||column==="id"&&value===targetId),"Unscoped inspection query "+call.table);
}
assert.ok(!state.calls.some(c=>["update","delete","createAuth"].includes(c.op)));
assert.ok(state.calls.filter(c=>c.op==="insert").every(c=>c.table==="audit_logs"&&c.value.organization_id===targetId&&c.value.after_data.read_only));
console.log("PASS all 17 inspection sections scope every root/child query to the selected business and write only audit evidence");
reset({profile:{id:userId,organization_id:orgId,role:"admin",full_name:"Admin",is_active:true,permissions:["dashboard","sales","stock"]},path:"/dashboard/sales/new"});
await assert.rejects(()=>access.requirePermission("sales"),/REDIRECT:.*restricted/);
reset({profile:{id:userId,organization_id:orgId,role:"admin",full_name:"Admin",is_active:true,permissions:["dashboard"]},business:{operational:true,enabledModules:[...registry.moduleKeys]},path:"/dashboard/stock"});
await assert.rejects(()=>access.requirePermission("stock"),/REDIRECT:.*Access denied/);
reset({business:{operational:false,enabledModules:[],reason:"suspended"},path:"/dashboard/purchases"});
await assert.rejects(()=>access.requirePermission("purchases"),/REDIRECT:.*account/);
reset({business:{operational:false,enabledModules:[],reason:"suspended"},path:"/dashboard/businesses"});
await assert.rejects(()=>access.requirePermission("users"),/REDIRECT:.*account/);
assert.equal((await load("lib/business-access.ts").requireSuperAdmin()).profile.role,"super_admin");
console.log("PASS direct route guards combine business, module and existing user permissions while preserving platform access");
assert.equal(registry.moduleForPath("/dashboard/sales/receivables"),"customer_receivables");
assert.equal(registry.moduleForPath("/dashboard/stock/adjustments"),"stock_adjustments");
assert.equal(registry.moduleForPath("/dashboard/cash/bank-accounts"),"bank");
assert.equal(registry.moduleEnabled("stock_transfers",["dashboard","stock_transfers"]),false);
assert.equal(registry.permissionEntitled("stock",["dashboard"]),false);

const userApi=load("app/api/admin/users/route.ts");
reset({profile:{id:userId,organization_id:orgId,full_name:"Admin",role:"admin",is_active:true,permissions:["dashboard","users"]}});
const unentitledUser=await userApi.POST(request({email:"staff@example.test",password:"valid-password",fullName:"Staff",role:"admin",centerIds:[],permissions:["dashboard","stock"]}));
assert.equal(unentitledUser.status,400);
assert.ok(!state.calls.some(c=>c.op==="createAuth"));
reset({business:{operational:false,enabledModules:["dashboard","users"],reason:"suspended"}});
assert.equal((await userApi.GET()).status,403);
assert.ok(!state.calls.some(c=>c.op==="serviceClient"));
console.log("PASS user management rejects disabled-module grants and suspended-business service-role operations");

reset();
const legacy=await list.POST(request({name:"Legacy caller",adminName:"Admin",email:"legacy@example.test",password:"valid-password"}));
assert.equal(legacy.status,201);
assert.deepEqual([...state.calls.find(c=>c.rpc==="platform_provision_business").args.p_modules],["dashboard"]);
reset();
assert.equal((await list.POST(request({...input,subscription:{...subscription,expires_on:"2026-02-30"}}))).status,400);
assert.ok(!state.calls.some(c=>c.op==="createAuth"));
console.log("PASS legacy provisioning payloads retain core-only defaults and invalid calendar dates fail before Auth changes");
