// Isolated PostgreSQL regression: business entitlements and admin permissions stay
// separate until a platform operator explicitly grants the selected admin access.
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

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
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
alter default privileges in schema public grant usage,select on sequences to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage,select on sequences to service_role;
`);
for (const name of (await readdir(new URL("../supabase/migrations/",import.meta.url)))
  .filter(name=>name.endsWith(".sql")&&!name.includes("verify")).sort()) {
  const sql=(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"))
    .replace("create extension if not exists pgcrypto;","");
  try { await db.exec(sql); } catch(error) { throw new Error("Migration "+name+": "+error.message); }
}

const platformOrg=randomUUID(),otherOrg=randomUUID(),platformActor=randomUUID(),inactivePlatformActor=randomUUID();
const owner=randomUUID(),staff=randomUUID(),secondAdmin=randomUUID(),otherAdmin=randomUUID(),businessSuper=randomUUID(),inactiveAdmin=randomUUID();
await db.query("insert into organizations(id,name) values($1,'Platform'),($2,'Other business')",[platformOrg,otherOrg]);
async function authUser(id) { await db.query("insert into auth.users(id) values($1)",[id]); }
async function profile(id,org,role,permissions,active=true) {
  await authUser(id);
  await db.query("insert into profiles(id,organization_id,full_name,email,role,permissions,is_active) values($1,$2,'Tester',$3,$4,$5,$6)",
    [id,org,id+"@example.test",role,permissions,active]);
}
await profile(platformActor,platformOrg,"super_admin",["dashboard"]);
await profile(inactivePlatformActor,platformOrg,"super_admin",["dashboard"],false);
await profile(otherAdmin,otherOrg,"admin",["dashboard","cash"]);
await authUser(owner);
async function actor(id) {
  await db.exec("reset role");
  await db.query("select set_config('test.user',$1,false)",[id??""]);
  if(id) await db.exec("set role authenticated");
}
async function service() { await actor(null); await db.exec("set role service_role"); }
const today=(await db.query("select (now() at time zone 'Asia/Colombo')::date::text d")).rows[0].d;
const subscription={plan:"Custom",status:"active",starts_on:today,expires_on:null,trial_ends_on:null,admin_notes:""};
const details={name:"New business",status:"active",address:"",phone:"",email:""};
await service();
const business=(await db.query("select platform_provision_business($1,$2,'Business owner','owner@example.test',array['dashboard','audit'],$3::jsonb,$4::jsonb,array['dashboard','audit']) id",
  [platformActor,owner,JSON.stringify(details),JSON.stringify(subscription)])).rows[0].id;
await actor(null);
await profile(staff,business,"center_user",["dashboard"]);
await profile(secondAdmin,business,"admin",["dashboard","audit"]);
await profile(businessSuper,business,"super_admin",["dashboard"]);
await profile(inactiveAdmin,business,"admin",["dashboard"],false);

const sorted=values=>[...values].sort();
async function permissions(id) {
  return (await db.query("select permissions from profiles where id=$1",[id])).rows[0].permissions;
}
async function access() { return (await db.query("select current_business_access() data")).rows[0].data; }
async function configure(modules) {
  await service();
  await db.query("select platform_save_business($1,$2,$3::jsonb,$4::jsonb,$5)",
    [platformActor,business,JSON.stringify(details),JSON.stringify(subscription),modules]);
}
async function grant(actorId=platformActor,org=business,target=owner) {
  return (await db.query("select platform_grant_business_admin_access($1,$2,$3) permissions",[actorId,org,target])).rows[0].permissions;
}
async function entitlementSnapshot() {
  return (await db.query("select organization_id,module_key,enabled,updated_at from business_module_entitlements order by organization_id,module_key")).rows;
}
async function otherProfileSnapshot() {
  return (await db.query("select id,organization_id,full_name,email,role,is_active,permissions,updated_at from profiles where id<>$1 order by id",[owner])).rows;
}
async function denied(call,code) {
  await assert.rejects(call,error=>!code||error.code===code);
}

await actor(owner);
assert.deepEqual(sorted(await permissions(owner)),["audit","dashboard"]);
const beforeAccess=await access();
assert.deepEqual(sorted(beforeAccess.userPermissions),["audit","dashboard"]);
assert.equal(beforeAccess.userRole,"admin");

const modules=["dashboard","audit","purchases","sales","inventory","stock_adjustments","masters","users","centers"];
await configure(modules);
await actor(owner);
assert.deepEqual(sorted(await permissions(owner)),["audit","dashboard"]);
assert.deepEqual(sorted((await access()).enabledModules),sorted(modules));
await denied(()=>db.query("select assert_business_operation('sales')"));
console.log("PASS reproduces new owner seeing only Dashboard/Audit after entitlement-only changes");

// A pre-existing unrelated permission must survive an explicit additive grant.
await actor(null);
await db.query("update profiles set permissions=array_append(permissions,'cash') where id=$1",[owner]);
await actor(owner);
const accessBeforeGrant=await access();
await actor(null);
const originalOthers=await otherProfileSnapshot();
const originalEntitlements=await entitlementSnapshot();
const originalSubscriptions=(await db.query("select * from business_subscriptions order by organization_id")).rows;
await service();
const granted=await grant();
const expected=["dashboard","audit","cash","purchases","sales","stock","stock_adjustment","masters","product_create","product_edit","users","centers"];
assert.deepEqual(sorted(granted),sorted(expected));
const again=await grant();
assert.deepEqual(sorted(again),sorted(expected));
assert.deepEqual(await otherProfileSnapshot(),originalOthers);
assert.deepEqual(await entitlementSnapshot(),originalEntitlements);
assert.deepEqual((await db.query("select * from business_subscriptions order by organization_id")).rows,originalSubscriptions);
const target=(await db.query("select organization_id,role,is_active,permissions from profiles where id=$1",[owner])).rows[0];
assert.equal(target.organization_id,business);
assert.equal(target.role,"admin");
assert.equal(target.is_active,true);
assert.deepEqual(sorted(target.permissions),sorted(expected));
const audits=(await db.query("select organization_id,actor_id,entity_type,entity_id from audit_logs where action='business_admin_access_granted' order by id")).rows;
assert.ok(audits.length>=1);
assert.ok(audits.every(row=>row.organization_id===business&&row.actor_id===platformActor&&row.entity_type==="profile"&&row.entity_id===owner));
console.log("PASS explicit grant derives selected module/action permissions, preserves old permissions, is idempotent and audits only the selected admin");

await actor(owner);
const afterAccess=await access();
assert.deepEqual(sorted(afterAccess.userPermissions),sorted(expected));
assert.equal(afterAccess.userRole,"admin");
assert.deepEqual(afterAccess.enabledModules,accessBeforeGrant.enabledModules);
assert.deepEqual(afterAccess.subscription,accessBeforeGrant.subscription);
assert.equal(afterAccess.businessStatus,accessBeforeGrant.businessStatus);
assert.notEqual(JSON.stringify(afterAccess),JSON.stringify(accessBeforeGrant));
await db.query("select assert_business_operation('sales')");
await db.query("select assert_business_operation('masters')");
await db.query("select assert_business_operation('stock_adjustments')");
await denied(()=>db.query("select assert_business_operation('cash')"));
console.log("PASS refreshed own-access metadata exposes current role/permissions while retained permissions cannot override disabled business modules");

// Database function is a service-only operation, even for an authenticated super admin.
await actor(owner); await denied(()=>grant(platformActor), "42501");
await actor(otherAdmin); await denied(()=>grant(platformActor), "42501");
await actor(platformActor); await denied(()=>grant(platformActor), "42501");
await actor(null); await db.exec("set role anon"); await denied(()=>grant(platformActor), "42501");
await service();
await denied(()=>grant(owner));
await denied(()=>grant(otherAdmin));
await denied(()=>grant(inactivePlatformActor));
await denied(()=>grant(randomUUID()));
await denied(()=>grant(platformActor,otherOrg,owner));
await denied(()=>grant(platformActor,business,otherAdmin));
await denied(()=>grant(platformActor,business,businessSuper));
await denied(()=>grant(platformActor,business,staff));
await denied(()=>grant(platformActor,business,inactiveAdmin));
await denied(()=>grant(platformActor,business,randomUUID()));
assert.deepEqual(await otherProfileSnapshot(),originalOthers);
assert.deepEqual(await entitlementSnapshot(),originalEntitlements);
console.log("PASS authenticated/anonymous, non-super/inactive actors and cross-business/super/staff/inactive targets cannot use the grant");

await configure(modules.filter(key=>key!=="sales"));
await actor(owner);
assert.ok((await permissions(owner)).includes("sales"));
await denied(()=>db.query("select assert_business_operation('sales')"));
await service();
const disabledEntitlements=await entitlementSnapshot();
await grant();
assert.deepEqual(await entitlementSnapshot(),disabledEntitlements);
assert.ok((await permissions(owner)).includes("sales"));
assert.deepEqual(await otherProfileSnapshot(),originalOthers);
await actor(owner);
await denied(()=>db.query("select assert_business_operation('sales')"));
console.log("PASS disabling a module still blocks its operations after permission repair, without revoking staff permissions or changing entitlements");
await db.close();
