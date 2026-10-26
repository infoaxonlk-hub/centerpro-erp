process.on("uncaughtException",e=>{console.error(e.message,e.where??"",e.query??"");process.exit(1)});
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


const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),outsider=randomUUID(),center=randomUUID(),loc=randomUUID(),loc2=randomUUID(),supplier=randomUUID();
await db.query("insert into organizations(id,name) values($1,'Sacks'),($2,'Other')",[org,otherOrg]);
await db.query("insert into business_subscriptions(organization_id) values($1),($2) on conflict do nothing",[org,otherOrg]);
await db.query("insert into business_module_entitlements(organization_id,module_key,enabled) select o.id,m.key,true from organizations o cross join business_module_catalog m on conflict(organization_id,module_key) do update set enabled=true");
for(const[id,oid]of[[admin,org],[outsider,otherOrg]]){await db.query("insert into auth.users(id) values($1)",[id]);await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Tester','admin',array['dashboard','purchases','sales','stock','stock_adjustment','masters','cash'])",[id,oid]);}
await db.query("insert into centers(id,organization_id,code,name,allow_multiple_locations) values($1,$2,'C','Center',true)",[center,org]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true),($3,$2,'SECOND','Second',false)",[loc,center,loc2]);
await db.query("insert into suppliers(id,organization_id,name) values($1,$2,'Supplier')",[supplier,org]);
await db.query("select set_config('test.user',$1,false)",[admin]);
await db.exec("set role authenticated");
const product=(await db.query("select create_product_with_pricing('P','Pepper',null,'KG',10,true) id")).rows[0].id;
const quality=(await db.query("select id from product_qualities where product_id=$1",[product])).rows[0].id;
assert.equal((await db.query("select tracks_sacks from products where id=$1",[product])).rows[0].tracks_sacks,true);
const purchaseLine={product_id:product,quality_id:quality,location_id:loc,quantity:100,actual_price:10};
const purchaseRequest=randomUUID(),params=[purchaseRequest,center,supplier,JSON.stringify([purchaseLine]),JSON.stringify([{method:'credit',amount:1000}]),JSON.stringify([{sack_count:10}])];
await assert.rejects(()=>db.query("select * from confirm_queued_purchase($1,$2,$3,'missing sacks',$4::jsonb,$5::jsonb)",params.slice(0,5)),/detailed purchase/i);
const purchase=(await db.query("select * from confirm_queued_purchase_detailed($1,$2,$3,'Sacks',$4::jsonb,$5::jsonb,$6::jsonb,false)",params)).rows[0].purchase_id;
const balance=async(location=loc)=>Number((await db.query("select coalesce(sum(delta),0) n from stock_sack_movements where location_id=$1",[location])).rows[0].n);
assert.equal(await balance(),10);
await db.query("select * from confirm_queued_purchase_detailed($1,$2,$3,'Sacks',$4::jsonb,$5::jsonb,$6::jsonb,false)",params);assert.equal(await balance(),10);
const saleLine={product_id:product,quality_id:quality,location_id:loc,quantity:20,unit_price:15,sack_count:2};
const saleParams=[randomUUID(),center,JSON.stringify([saleLine]),JSON.stringify([{method:'cash',amount:300}])];
const sale=(await db.query("select confirm_center_sale($1,$2,null,'Sacks',$3::jsonb,$4::jsonb) id",saleParams)).rows[0].id;assert.equal(await balance(),8);
await db.query("select confirm_center_sale($1,$2,null,'Sacks',$3::jsonb,$4::jsonb)",saleParams);assert.equal(await balance(),8);
await assert.rejects(()=>db.query("select confirm_center_sale($1,$2,null,'Sacks',$3::jsonb,$4::jsonb)",[randomUUID(),center,JSON.stringify([{...saleLine,sack_count:99}]),saleParams[3]]),/Insufficient sacks/i);assert.equal(await balance(),8);
await assert.rejects(()=>db.query("select confirm_center_sale($1,$2,null,'Sacks',$3::jsonb,$4::jsonb)",[randomUUID(),center,JSON.stringify([{...saleLine,sack_count:undefined}]),saleParams[3]]),/whole sack/i);
const transfer=randomUUID();await db.query("select create_stock_transfer($1,$2,$3,$2,$4,$5::jsonb,'Sacks')",[transfer,center,loc,loc2,JSON.stringify([{product_id:product,quality_id:quality,quantity:10,sack_count:1}])]);assert.equal(await balance(),7);assert.equal(await balance(loc2),1);
await db.query("select create_stock_transfer($1,$2,$3,$2,$4,$5::jsonb,'Sacks')",[transfer,center,loc,loc2,JSON.stringify([{product_id:product,quality_id:quality,quantity:10,sack_count:1}])]);assert.equal(await balance(),7);
const countRequest=randomUUID();await db.query("select create_stock_adjustment($1,$2,$3,$4,$5,70,null,'Sack count only',9)",[countRequest,center,loc,product,quality]);assert.equal(await balance(),9);
await db.query("select create_stock_adjustment($1,$2,$3,$4,$5,70,null,'Sack count only',9)",[countRequest,center,loc,product,quality]);assert.equal(await balance(),9);
const source=(await db.query("select id from sales_order_lines where sales_order_id=$1",[sale])).rows[0].id;
const ret=(await db.query("select request_bill_return('sale',$1,'Partial return',$2::jsonb) id",[sale,JSON.stringify([{line_id:source,quantity:10,sack_count:1}])])).rows[0].id;
await db.query("select review_bill_return($1,true,'Approved')",[ret]);assert.equal(await balance(),10);
await assert.rejects(()=>db.query("select review_bill_return($1,true,'Retry')",[ret]),/Pending return/i);assert.equal(await balance(),10);
const cancelledSale=(await db.query("select confirm_center_sale($1,$2,null,'Cancel sacks',$3::jsonb,$4::jsonb) id",[randomUUID(),center,JSON.stringify([{...saleLine,quantity:5,sack_count:1}]),JSON.stringify([{method:'cash',amount:75}])])).rows[0].id;assert.equal(await balance(),9);
const cancel=(await db.query("select request_bill_cancellation('sale',$1,'Test cancellation') id",[cancelledSale])).rows[0].id;
await db.query("select review_bill_cancellation($1,true,'Approved')",[cancel]);assert.equal(await balance(),10);

const snapshot=(await db.query("select stock_scrap_balances() rows")).rows[0].rows;
assert.equal(snapshot.find(r=>r.locationId===loc).tracksSacks,true);
assert.equal(snapshot.find(r=>r.locationId===loc).sacks,10);
const scrapRequest=randomUUID();const scrapArgs=[scrapRequest,center,loc,JSON.stringify([{product_id:product,quality_id:quality,quantity:5,sack_count:1}])];
await db.query("select create_stock_scrap($1,$2,$3,$4::jsonb,'Damaged sacks')",scrapArgs);assert.equal(await balance(),9);
await db.query("select create_stock_scrap($1,$2,$3,$4::jsonb,'Damaged sacks')",scrapArgs);assert.equal(await balance(),9);
const extraParams=[randomUUID(),center,supplier,JSON.stringify([{...purchaseLine,quantity:10}]),JSON.stringify([{method:'credit',amount:100}]),JSON.stringify([{sack_count:2}])];
const cancelledPurchase=(await db.query("select * from confirm_queued_purchase_detailed($1,$2,$3,'Cancel purchase',$4::jsonb,$5::jsonb,$6::jsonb,false)",extraParams)).rows[0].purchase_id;assert.equal(await balance(),11);
const cancelPurchaseRequest=(await db.query("select request_bill_cancellation('purchase',$1,'Cancel unused sacks') id",[cancelledPurchase])).rows[0].id;
await db.query("select review_bill_cancellation($1,true,'Approved')",[cancelPurchaseRequest]);assert.equal(await balance(),9);
const plainProduct=(await db.query("select create_product_with_pricing('PLAIN','Plain product',null,'UNIT',10,false) id")).rows[0].id;
const plainQuality=(await db.query("select id from product_qualities where product_id=$1",[plainProduct])).rows[0].id;
await db.query("select * from confirm_queued_purchase($1,$2,$3,'Plain POS',$4::jsonb,$5::jsonb)",[randomUUID(),center,supplier,JSON.stringify([{product_id:plainProduct,quality_id:plainQuality,location_id:loc,quantity:1,actual_price:10}]),JSON.stringify([{method:'credit',amount:10}])]);
assert.equal(await balance(),9);
console.log("PASS scrap balances, scrap retry, purchase cancellation and untracked POS compatibility.");

await assert.rejects(()=>db.query("insert into stock_sack_movements(organization_id,center_id,location_id,product_id,quality_id,delta,reference_type,reference_id,source_line_id) values($1,$2,$3,$4,$5,99,'fake',$6,$6)",[org,center,loc,product,quality,randomUUID()]),/permission denied/i);
await db.query("select set_config('test.user',$1,false)",[outsider]);assert.equal((await db.query("select count(*)::int n from stock_sack_movements")).rows[0].n,0);
console.log("PASS sacks: required detailed purchases, idempotency, sales, overdraw rollback, transfer, sack-only adjustment, returns, cancellation and tenant isolation.");
await db.close();
