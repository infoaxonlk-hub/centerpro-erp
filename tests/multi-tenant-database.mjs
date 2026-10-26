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
-- Supabase supplies default table grants.
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
alter default privileges in schema public grant usage,select on sequences to authenticated;
`);
for (const name of (await readdir(new URL("../supabase/migrations/",import.meta.url))).filter(n => n.endsWith(".sql") && !n.includes("verify")).sort()) {
  const sql = (await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8")).replace("create extension if not exists pgcrypto;","");
  try { await db.exec(sql); } catch(error) { throw new Error("Migration "+name+": "+error.message); }
}
console.log("PASS all migrations apply");
const ids = Object.fromEntries(["a","b","adminA","adminB","super","staff","centerA","centerB","locationA","locationB","productA","productB","qualityA","qualityB","supplierA","supplierB"].map(k=>[k,randomUUID()]));
await db.query("insert into organizations(id,name) values($1,'Business A'),($2,'Business B')",[ids.a,ids.b]);
for (const [id,org,role] of [[ids.adminA,ids.a,"admin"],[ids.adminB,ids.b,"admin"],[ids.super,ids.a,"super_admin"],[ids.staff,ids.a,"center_user"]]) {
 await db.query("insert into auth.users(id) values($1)",[id]);
 await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Test',$3,array['dashboard','users','centers','masters','sales','purchases','cash'])",[id,org,role]);
}
for (const suffix of ["A","B"]) {
 const org=ids[suffix.toLowerCase()];
 await db.query("insert into centers(id,organization_id,code,name) values($1,$2,'MAIN','Main')",[ids["center"+suffix],org]);
 await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true)",[ids["location"+suffix],ids["center"+suffix]]);
 await db.query("insert into products(id,organization_id,code,name) values($1,$2,'PRODUCT','Product')",[ids["product"+suffix],org]);
 await db.query("insert into product_qualities(id,product_id,name,default_price) values($1,$2,'Quality',10)",[ids["quality"+suffix],ids["product"+suffix]]);
 await db.query("insert into suppliers(id,organization_id,name) values($1,$2,'Supplier')",[ids["supplier"+suffix],org]);
}
await db.query("insert into user_center_access(user_id,center_id) values($1,$2)",[ids.staff,ids.centerA]);
await db.query("insert into stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values($1,$2,$3,$4,$5,'purchase_in',100,10,'test',$6,$7)",[ids.a,ids.centerA,ids.locationA,ids.productA,ids.qualityA,randomUUID(),ids.adminA]);
await db.query("insert into storage.objects(bucket_id,name) values('product-images',$1),('product-images',$2)",[ids.a+"/photo.png",ids.b+"/photo.png"]);
async function actor(id) {
 await db.exec("reset role");
 await db.query("select set_config('test.user',$1,false)",[id ?? ""]);
 if(id) await db.exec("set role authenticated");
}
async function denied(sql,params=[]) {
 let rejected=false;
 try { await db.query(sql,params); } catch(error) { rejected=true; assert.match(error.message,/access|permission|policy|business|another|denied|user management/i); }
 assert.ok(rejected,"Expected denial: "+sql);
}
for (const [who,org,center,product] of [[ids.adminA,ids.a,ids.centerA,ids.productA],[ids.adminB,ids.b,ids.centerB,ids.productB],[ids.super,ids.a,ids.centerA,ids.productA],[ids.staff,ids.a,ids.centerA,ids.productA]]) {
 await actor(who);
 assert.deepEqual((await db.query("select id from centers")).rows.map(r=>r.id),[center]);
 assert.deepEqual((await db.query("select id from products")).rows.map(r=>r.id),[product]);
 assert.equal((await db.query("select count(*)::int n from product_qualities")).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from profiles where organization_id<>$1",[org])).rows[0].n,0);
 assert.equal((await db.query("select can_access_center($1) allowed",[center===ids.centerA?ids.centerB:ids.centerA])).rows[0].allowed,false);
}
console.log("PASS admins, platform admin and center users read only their own business");
await actor(ids.adminA);
assert.equal((await db.query("update products set name='Wrong' where id=$1 returning id",[ids.productB])).rows.length,0);
assert.equal((await db.query("delete from products where id=$1 returning id",[ids.productB])).rows.length,0);
await denied("insert into products(organization_id,code,name) values($1,'BAD','Bad')",[ids.b]);
await denied("insert into product_qualities(product_id,name,default_price) values($1,'Bad',10)",[ids.productB]);
await denied("insert into user_center_access(user_id,center_id) values($1,$2)",[ids.adminA,ids.centerB]);
await denied("update profiles set role='super_admin' where id=$1",[ids.adminA]);
await denied("update profiles set organization_id=$1 where id=$2",[ids.b,ids.adminA]);
await denied("select sales_stock($1)",[ids.centerB]);
await denied("select center_cash_balance($1)",[ids.centerB]);
await denied("select set_sales_price($1,$2,15)",[ids.centerA,ids.qualityB]);
await denied("select ensure_cash_accounts($1,$2)",[ids.b,ids.centerB]);
await denied("select _tenant_row_organization('public.locations',jsonb_build_object('center_id',$1::text),0)",[ids.centerB]);
assert.equal((await db.query("select tenant_row_organization('public.locations',jsonb_build_object('center_id',$1::text)) org",[ids.centerB])).rows[0].org,null);
await db.query("insert into products(organization_id,code,name) values($1,'OWN','Own product')",[ids.a]);

const customer=(await db.query("select create_sales_customer($1,'Customer',null,null) id",[ids.centerA])).rows[0].id;
assert.ok(customer);
const sale=(await db.query("select confirm_center_sale($1,$2,$3,'Tenant test',$4::jsonb,$5::jsonb) id",[
 randomUUID(),ids.centerA,customer,
 JSON.stringify([{product_id:ids.productA,quality_id:ids.qualityA,location_id:ids.locationA,quantity:2,unit_price:25}]),
 JSON.stringify([{method:"cash",amount:50}])
])).rows[0].id;
assert.ok(sale);
const purchase=(await db.query("select * from create_and_confirm_purchase_split($1,$2,'Tenant purchase',$3::jsonb,$4::jsonb)",[
 ids.centerA,ids.supplierA,
 JSON.stringify([{product_id:ids.productA,quality_id:ids.qualityA,location_id:ids.locationA,quantity:1,actual_price:10}]),
 JSON.stringify([{method:"credit",amount:10}])
])).rows[0];
assert.ok(purchase.purchase_id);
assert.equal(Number((await db.query("select center_cash_balance($1) balance",[ids.centerA])).rows[0].balance),50);
assert.equal((await db.query("select count(*)::int n from sales_order_lines")).rows[0].n,1);
assert.deepEqual((await db.query("select name from storage.objects")).rows.map(r=>r.name),[ids.a+"/photo.png"]);
await actor(ids.adminB);
assert.equal((await db.query("select count(*)::int n from sales_order_lines")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from sales_payments")).rows[0].n,0);
await actor(ids.adminA);
console.log("PASS cross-business reads, writes, references, privilege escalation and RPCs denied; own-business sale and cash posting work");
// Exercise SECURITY DEFINER writes directly, including composite references.
await actor(null);
await db.exec("create function public.test_privileged_update(p_id uuid) returns void language sql security definer as $$ update public.products set name='Changed' where id=p_id $$; grant execute on function public.test_privileged_update(uuid) to authenticated");
await actor(ids.adminA);
await denied("select test_privileged_update($1)",[ids.productB]);
await db.query("select test_privileged_update($1)",[ids.productA]);
console.log("PASS tenant guard protects SECURITY DEFINER writes");
await actor(null);
await db.query("update profiles set is_active=false where id=$1",[ids.adminA]);
await actor(ids.adminA);
assert.equal((await db.query("select count(*)::int n from products")).rows[0].n,0);
assert.equal((await db.query("select can_access_center($1) allowed",[ids.centerA])).rows[0].allowed,false);
await denied("select test_privileged_update($1)",[ids.productA]);
console.log("PASS inactive users have no tenant access");
await db.close();
