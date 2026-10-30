import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {createRequire} from "node:module";
import vm from "node:vm";

if (!process.env.PGLITE_MODULE) throw new Error("Set PGLITE_MODULE to @electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
await db.exec(`
create schema auth; create schema storage;
create role authenticated; create role anon; create role service_role bypassrls;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant select on storage.objects to authenticated;
-- Supabase supplies default table grants.
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage,select on sequences to service_role;
alter default privileges in schema public grant usage,select on sequences to authenticated;
`);
for (const name of (await readdir(new URL("../supabase/migrations/",import.meta.url))).filter(n => n.endsWith(".sql") && !n.includes("verify")).sort().filter(name=>name<"045")) {
  const sql = (await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8")).replace("create extension if not exists pgcrypto;","");
  try { await db.exec(sql); } catch(error) { throw new Error("Migration "+name+": "+error.message); }
}

const orgA=randomUUID(),orgB=randomUUID(),superId=randomUUID(),adminId=randomUUID(),otherId=randomUUID(),staffId=randomUUID();
await db.query("insert into organizations(id,name) values($1,'Legacy A'),($2,'Legacy B')",[orgA,orgB]);
for(const [id,org,role,permissions] of [
 [superId,orgA,"super_admin",["dashboard"]],
 [adminId,orgA,"admin",["dashboard","users","purchases","sales","stock","stock_adjustment","cash","labor","masters","centers","payment_reports","audit"]],
 [otherId,orgB,"admin",["dashboard","sales","purchases","stock","masters"]],
 [staffId,orgA,"center_user",["dashboard"]]
]){
 await db.query("insert into auth.users(id) values($1)",[id]);
 await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Test',$3,$4)",[id,org,role,permissions]);
}
for (const name of (await readdir(new URL("../supabase/migrations/",import.meta.url))).filter(n=>n.endsWith(".sql")&&n>="045").sort()) {
 await db.exec(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"));
}
const allModules=(await db.query("select key from business_module_catalog order by key")).rows.map(r=>r.key);
assert.equal(allModules.length,20);
assert.ok(allModules.includes("farm_services"));
assert.ok(allModules.includes('manufacturing'));
assert.equal((await db.query("select count(*)::int n from business_module_entitlements where enabled")).rows[0].n,36);
assert.equal((await db.query("select count(*)::int n from business_subscriptions where status='active' and expires_on is null")).rows[0].n,2);
console.log("PASS legacy businesses retain all modules and subscriptions without expiry");
const center=randomUUID(),location=randomUUID(),product=randomUUID(),quality=randomUUID(),supplier=randomUUID();
await db.query("insert into centers(id,organization_id,code,name) values($1,$2,'MAIN','Main')",[center,orgA]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true)",[location,center]);
await db.query("insert into products(id,organization_id,code,name) values($1,$2,'P','Product')",[product,orgA]);
await db.query("insert into product_qualities(id,product_id,name,default_price) values($1,$2,'A',10)",[quality,product]);
await db.query("insert into suppliers(id,organization_id,name) values($1,$2,'Supplier')",[supplier,orgA]);
await db.query("insert into user_center_access(user_id,center_id) values($1,$2)",[staffId,center]);
await db.exec("create function public.test_business_definer(p_id uuid) returns void language sql security definer as $$ update public.products set name='Changed' where id=p_id $$; grant execute on function public.test_business_definer(uuid) to authenticated");
async function actor(id){
 await db.exec("reset role");
 await db.query("select set_config('test.user',$1,false)",[id??""]);
 if(id)await db.exec("set role authenticated");
}
async function service(){
 await actor(null);await db.exec("set role service_role");
}
const today=(await db.query("select (now() at time zone 'Asia/Colombo')::date::text d")).rows[0].d;
const baseSubscription={plan:"Custom",status:"active",starts_on:today,expires_on:null,trial_ends_on:null,admin_notes:"Private platform note"};
async function configure({org=orgA,status="active",modules=allModules,subscription=baseSubscription,name="Legacy A"}={}){
 await service();
 await db.query("select platform_save_business($1,$2,$3::jsonb,$4::jsonb,$5)",[superId,org,JSON.stringify({name,status,address:"Test address",phone:"",email:""}),JSON.stringify(subscription),modules]);
}
async function denied(sql,values=[],pattern=/access|restricted|permission|policy|platform|denied/i){
 await assert.rejects(()=>db.query(sql,values),pattern);
}
await actor(adminId);
assert.equal((await db.query("select current_business_access() access")).rows[0].access.operational,true);
assert.ok(!JSON.stringify((await db.query("select current_business_access() access")).rows[0]).includes("admin_notes"));
await denied("select admin_notes from business_subscriptions");
await denied("update business_module_entitlements set enabled=false");
await denied("update business_subscriptions set status='cancelled'");
await denied("select platform_save_business($1,$2,'{}','{}',array['dashboard'])",[superId,orgB]);
await denied("select business_operational($1)",[orgB]);
console.log("PASS business admins cannot change entitlements/subscriptions or read private notes/other business status");
await configure({status:"suspended"});
await actor(adminId);
assert.equal((await db.query("select current_business_access() access")).rows[0].access.reason,"suspended");
assert.equal((await db.query("select count(*)::int n from products")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from centers")).rows[0].n,0);
assert.equal((await db.query("select is_admin() a")).rows[0].a,false);
assert.equal((await db.query("select can_access_center($1) a",[center])).rows[0].a,false);
await denied("select test_business_definer($1)",[product]);
await denied("select sales_stock($1)",[center]);
await denied("select confirm_center_sale($1,$2,null,null,'[]','[]')",[randomUUID(),center]);
await denied("select create_and_confirm_purchase_split($1,$2,null,'[]','[]')",[center,supplier]);
assert.equal((await db.query("select count(*)::int n from organizations")).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from profiles where id=$1",[adminId])).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from profiles where id<>$1",[adminId])).rows[0].n,0);
await actor(otherId);
assert.equal((await db.query("select current_business_access() access")).rows[0].access.operational,true);
await configure({name:"Renamed by platform while suspended"});
await actor(adminId);
assert.equal((await db.query("select current_business_access() access")).rows[0].access.operational,true);
await db.query("select test_business_definer($1)",[product]);
console.log("PASS suspension blocks existing sessions, RPCs, direct reads and SECURITY DEFINER writes; support and reactivation remain available");

const yesterday=(await db.query("select ((now() at time zone 'Asia/Colombo')::date-1)::text d")).rows[0].d;
for(const subscription of [
 {...baseSubscription,starts_on:yesterday,expires_on:yesterday},
 {...baseSubscription,status:"expired"},
 {...baseSubscription,status:"cancelled"},
 {...baseSubscription,status:"past_due"},
 {...baseSubscription,status:"trialing",starts_on:yesterday,trial_ends_on:yesterday},
 {...baseSubscription,starts_on:"2099-01-01"}
]){
 await configure({subscription});
 await actor(adminId);
 assert.equal((await db.query("select current_business_access() access")).rows[0].access.operational,false);
 await denied("select sales_stock($1)",[center]);
 await denied("select test_business_definer($1)",[product]);
}
await configure({subscription:{...baseSubscription,expires_on:today}});
await actor(adminId);
assert.equal((await db.query("select current_business_access() access")).rows[0].access.operational,true);
console.log("PASS expiry, past due, cancellation, trial expiry, scheduled starts and inclusive expiration dates");

await configure({modules:["dashboard","purchases","users"]});
await actor(adminId);
const current=(await db.query("select current_business_access() access")).rows[0].access;
assert.deepEqual(current.enabledModules.sort(),["dashboard","purchases","users"]);
await denied("insert into centers(organization_id,code,name) values($1,'DISABLED','Disabled center')",[orgA]);
await denied("select sales_stock($1)",[center]);
await denied("select confirm_center_sale_with_labor($1,$2,null,null,'[]','[]',null,0)",[randomUUID(),center]);
await denied("select create_stock_adjustment($1,$2,$3,$4,$5,2,null,'Count test')",[randomUUID(),center,location,product,quality]);
await denied("select import_products('[]'::jsonb)");
await denied("select stock_scrap_balances()");
assert.equal((await db.query("delete from products where id=$1 returning id",[product])).rows.length,0);
const po=(await db.query("select * from create_and_confirm_purchase_split($1,$2,null,$3::jsonb,$4::jsonb)",[
 center,supplier,JSON.stringify([{product_id:product,quality_id:quality,location_id:location,quantity:2,actual_price:10}]),JSON.stringify([{method:"credit",amount:20}])
])).rows[0];
assert.ok(po.purchase_id);
assert.equal((await db.query("select count(*)::int n from purchase_orders")).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from stock_movements")).rows[0].n,0);
await actor(null);
assert.equal((await db.query("select count(*)::int n from stock_movements")).rows[0].n,1);
console.log("PASS disabled Sales/Inventory/Masters entrypoints are blocked; enabled Purchases still posts internal stock without exposing inventory");

await configure();
await actor(staffId);
assert.equal((await db.query("select has_permission('stock') a")).rows[0].a,false);
assert.equal((await db.query("select count(*)::int n from stock_movements")).rows[0].n,0);
await denied("select center_cash_balance($1)",[center]);
const scrapSnapshot=(await db.query("select stock_scrap_balances() data")).rows[0].data;
assert.equal(scrapSnapshot.length,1);
assert.equal(scrapSnapshot[0].centerId,center);
const scrap=(await db.query("select create_stock_scrap($1,$2,$3,$4::jsonb,'Damaged goods') id",[randomUUID(),center,location,JSON.stringify([{product_id:product,quality_id:quality,quantity:0.5}])])).rows[0].id;
assert.ok(scrap);
assert.equal((await db.query("select count(*)::int n from stock_scraps")).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from stock_movements")).rows[0].n,0);
console.log("PASS delegated center-user Scrap access is preserved through scoped snapshots without granting Stock explorer or raw ledger access");
await denied("select create_stock_adjustment($1,$2,$3,$4,$5,2,null,'Count test')",[randomUUID(),center,location,product,quality],/access|permission/i);
await actor(adminId);
assert.equal((await db.query("select count(*)::int n from organizations where id=$1",[orgB])).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from business_module_entitlements where organization_id=$1",[orgB])).rows[0].n,0);
await actor(null);
const history=(await db.query("select count(*)::int n from business_subscription_history where organization_id=$1",[orgA])).rows[0].n;
assert.ok(history>5);
const newAdmin=randomUUID();
await db.query("insert into auth.users(id) values($1)",[newAdmin]);
await service();
const newOrg=(await db.query("select platform_provision_business($1,$2,'New Admin','new@example.test',array['dashboard'],$3::jsonb,$4::jsonb,array['dashboard','purchases']) id",[
 superId,newAdmin,JSON.stringify({name:"New business",status:"active",address:"",phone:"",email:""}),JSON.stringify(baseSubscription)
])).rows[0].id;
await actor(newAdmin);
assert.deepEqual((await db.query("select current_business_access() access")).rows[0].access.enabledModules.sort(),["dashboard","purchases"]);
assert.equal((await db.query("select organization_id from profiles where id=$1",[newAdmin])).rows[0].organization_id,newOrg);
assert.equal((await db.query("select count(*)::int n from centers")).rows[0].n,0);
await actor(null);
assert.equal((await db.query("select organization_id from profiles where id=$1",[superId])).rows[0].organization_id,orgA);
console.log("PASS scoped provisioning selects only requested modules; existing user permissions and tenant boundaries remain intact");
await service();
const before=(await db.query("select count(*)::int n from organizations")).rows[0].n;
const orphan=randomUUID();
await actor(null);await db.query("insert into auth.users(id) values($1)",[orphan]);await service();
await denied("select platform_provision_business($1,$2,'Bad Admin','bad@example.test',array['dashboard'],$3::jsonb,$4::jsonb,array['unknown'])",[superId,orphan,JSON.stringify({name:"Invalid",status:"active"}),JSON.stringify(baseSubscription)],/module/i);
assert.equal((await db.query("select count(*)::int n from organizations")).rows[0].n,before);
assert.equal((await db.query("select count(*)::int n from profiles where id=$1",[orphan])).rows[0].n,0);
console.log("PASS failed provisioning rolls back organization, profile, subscription and entitlements atomically");

// Ensure every operational table has an explicit resource-module classification.
await actor(null);
const tables=(await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not in ('organizations','profiles','business_module_catalog','business_subscriptions','business_module_entitlements','business_subscription_history')")).rows;
for(const {relname} of tables){
 const modules=(await db.query("select business_table_modules($1,'{}',false) m",[relname])).rows[0].m;
 if(relname!=="bill_return_lines")assert.ok(modules?.length,"Missing module classification: "+relname);
 const policies=(await db.query("select count(*)::int n from pg_policy where polrelid=('public.'||$1)::regclass and polname in ('tenant_boundary','business_operation_boundary','business_delete_boundary')",[relname])).rows[0].n;
 assert.equal(policies,3,relname+" must retain tenant and business boundaries");
}
console.log("PASS every operational table retains tenant policy and adds business/module read/write/delete boundaries");

await actor(null);
assert.equal((await db.query("select count(*)::int n from audit_logs where after_data::text like '%Private platform note%' or before_data::text like '%Private platform note%'")).rows[0].n,0);
await configure({modules:["dashboard","labor","expenses"]});
await actor(null);
await db.query("update profiles set permissions=array['dashboard','labor'] where id=$1",[staffId]);
const worker=randomUUID(),session=randomUUID();
await db.query("insert into laborers(id,organization_id,full_name,rate_basis,rate) values($1,$2,'Worker','per_kg',2)",[worker,orgA]);
await db.query("insert into labor_sessions(id,organization_id,center_id,operation,title,created_by) values($1,$2,$3,'purchase','Test wages',$4)",[session,orgA,center,adminId]);
await db.query("insert into labor_session_workers(session_id,laborer_id,rate_basis,rate) values($1,$2,'per_kg',2)",[session,worker]);
await db.query("update purchase_orders set labor_session_id=$1 where id=$2",[session,po.purchase_id]);
await db.query("insert into cash_ledger(organization_id,center_id,movement_type,amount,reference_type,created_by) values($1,$2,'allocation',100,'test',$3)",[orgA,center,adminId]);
await actor(staffId);
const linked=(await db.query("select labor_linked_orders() data")).rows[0].data;
assert.equal(linked.purchases[0].id,po.purchase_id);
assert.equal(linked.purchases[0].purchase_order_lines[0].quantity,2);
assert.ok(!JSON.stringify(linked).includes("total_amount"));
assert.equal((await db.query("select count(*)::int n from purchase_orders")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from stock_movements")).rows[0].n,0);
await denied("select create_center_expense($1,null,current_date,'Unauthorized',1,'cash')",[center]);
await denied("select _labor_post_expense($1,null,current_date,'Unauthorized',1,'cash')",[center]);
const wage=(await db.query("select pay_labor_session_worker($1,$2,$3,2,'Wage test') id",[randomUUID(),session,worker])).rows[0].id;
assert.ok(wage);
assert.equal((await db.query("select count(*)::int n from labor_payments")).rows[0].n,1);
assert.equal((await db.query("select count(*)::int n from expenses")).rows[0].n,0);
await actor(null);
assert.equal(Number((await db.query("select amount from expenses where id=$1",[wage])).rows[0].amount),2);
console.log("PASS labor-only users retain scoped wage calculations and private expense posting without receiving Purchases, Cash or Expenses permissions");

await actor(null);
const require=createRequire(import.meta.url),ts=require("typescript");
function evaluate(filename){
 const mod={exports:{}};
 const compiled=ts.transpileModule(filename,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:name=>name==="zod"?require("zod"):{}});
 return mod.exports;
}
const registry=evaluate(await readFile(new URL("../lib/business-modules.ts",import.meta.url),"utf8"));
assert.deepEqual([...registry.moduleKeys].sort(),allModules);
const {inspectionSections}=evaluate(await readFile(new URL("../lib/business-inspection.ts",import.meta.url),"utf8"));
async function validateSelection(table,select){
 const fields=[];let depth=0,current="";
 for(const char of select+","){
   if(char===","&&depth===0){fields.push(current);current="";continue;}
   if(char==="(")depth++;if(char===")")depth--;current+=char;
 }
 const scalar=fields.filter(field=>!field.includes("("));
 await db.query('select '+scalar.map(field=>'"'+field+'"').join(",")+' from "'+table+'" limit 0');
 for(const field of fields.filter(field=>field.includes("("))){
   const child=field.slice(0,field.indexOf("("));
   assert.equal((await db.query("select count(*)::int n from pg_constraint where contype='f' and conrelid=('public.'||$1)::regclass and confrelid=('public.'||$2)::regclass",[child,table])).rows[0].n,1,"Inspection child must inherit ownership from its parent");
   await validateSelection(child,field.slice(field.indexOf("(")+1,-1));
 }
}
for(const section of Object.values(inspectionSections))await validateSelection(section.table,section.select);
console.log("PASS centralized module keys match the DB catalogue and every inspection field/child relationship exists in PostgreSQL");
await db.close();
