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
for(const[id,oid]of[[admin,org],[outsider,otherOrg]]){await db.query("insert into auth.users(id) values($1)",[id]);await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Tester','admin',array['dashboard','purchases','sales','stock','stock_adjustment','masters','cash','labor'])",[id,oid]);}
await db.query("insert into centers(id,organization_id,code,name,allow_multiple_locations) values($1,$2,'C','Center',true)",[center,org]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true),($3,$2,'SECOND','Second',false)",[loc,center,loc2]);
await db.query("insert into suppliers(id,organization_id,name) values($1,$2,'Supplier')",[supplier,org]);
await db.query("select set_config('test.user',$1,false)",[admin]);
await db.exec("set role authenticated");

const product=(await db.query("select create_product_with_pricing('LOT','Tracked',null,'KG',10,false,true) id")).rows[0].id;
const quality=(await db.query("select id from product_qualities where product_id=$1",[product])).rows[0].id;
const plain=(await db.query("select create_product_with_pricing('PLAIN','Plain',null,'KG',10) id")).rows[0].id;
const plainQuality=(await db.query("select id from product_qualities where product_id=$1",[plain])).rows[0].id;
assert.equal((await db.query("select tracks_purchase_lots from products where id=$1",[plain])).rows[0].tracks_purchase_lots,false);
const line=(quantity=10,price=10,lot_selection)=>({product_id:product,quality_id:quality,location_id:loc,quantity,actual_price:price,...(lot_selection?{lot_selection}:{})});
const rows=async(table)=>(await db.query("select * from "+table)).rows;
const count=async(table)=>(await rows(table)).length;
async function confirm(lines,request=randomUUID(),extra={}){
 const total=lines.reduce((sum,l)=>sum+Math.round(l.quantity*l.actual_price*100),0)/100;
 return(await db.query("select * from confirm_queued_purchase_with_lots($1,$2,$3,'Lot test',$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,false)",
 [request,center,supplier,JSON.stringify(lines),JSON.stringify([{method:'credit',amount:total}]),extra.session??null,extra.loads??0,extra.detailed??false,JSON.stringify(extra.sacks??[])])).rows[0];
}
const output=(await db.query("select create_product_with_pricing('RICE','Rice',null,'KG',0,false,true) id")).rows[0].id;
const outputQuality=(await db.query('select id from product_qualities where product_id=$1',[output])).rows[0].id;
await confirm([line(100,10,{mode:'number',number:'PADDY'})]);
const sourceLot=(await rows('purchase_lots'))[0].id;
const recipe=(await db.query("select * from save_manufacturing_recipe(null,$1::jsonb)",[JSON.stringify({name:'Rice milling',process_type:'milling',operation_cost_rate:2})])).rows[0];
assert.ok(recipe.recipe_id);
const payload={center_id:center,location_id:loc,process_type:'milling',method:'own',recipe_id:recipe.recipe_id,operation_cost_basis:'per_kg',operation_cost_rate:2,inputs:[{input_kind:'raw_material',product_id:product,quality_id:quality,lot_id:sourceLot,quantity:20}],outputs:[{output_kind:'main',product_id:output,quality_id:outputQuality,quantity:15}]};
const saved=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(payload)])).rows[0];
const completed=(await db.query('select * from complete_manufacturing_order($1)',[saved.order_id])).rows[0];
assert.equal(completed.status,'completed');assert.equal(Number(completed.total_cost),240);
const stock=async(productId,lotId)=>Number((await db.query('select * from stock_lot_balances()')).rows.filter(r=>r.product_id===productId&&(lotId===undefined||r.lot_id===lotId)).reduce((n,r)=>n+Number(r.available_quantity),0));
assert.equal(await stock(product),80);assert.equal(await stock(output),15);
const beforeRetry=[await count('stock_movements'),await count('purchase_lots')];
await db.query('select * from complete_manufacturing_order($1)',[saved.order_id]);
await db.query('select * from save_manufacturing_order($1,$2::jsonb)',[saved.order_id,JSON.stringify({...payload,inputs:[]})]);
assert.deepEqual([await count('stock_movements'),await count('purchase_lots')],beforeRetry);
// A lost draft-save response must reuse its client-generated identity.
const clientId=randomUUID();
await db.query('select * from save_manufacturing_order($1,$2::jsonb)',[clientId,JSON.stringify(payload)]);
await db.query('select * from save_manufacturing_order($1,$2::jsonb)',[clientId,JSON.stringify(payload)]);
assert.equal((await rows('manufacturing_orders')).filter(o=>o.id===clientId).length,1);
assert.equal((await rows('manufacturing_order_inputs')).filter(i=>i.order_id===clientId).length,1);
// Duplicate rows selecting the same lot must be checked as they are consumed.
const excessive={...payload,inputs:[{...payload.inputs[0],quantity:50},{...payload.inputs[0],quantity:50}]};
const tooMuch=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(excessive)])).rows[0];
const beforeFailure=[await count('stock_movements'),await count('purchase_lots'),await stock(product)];
await assert.rejects(()=>db.query('select * from complete_manufacturing_order($1)',[tooMuch.order_id]),/Insufficient stock/);
assert.deepEqual([await count('stock_movements'),await count('purchase_lots'),await stock(product)],beforeFailure);
// Cost must remain 10 after previous outbound movements, not a double-signed sum.
const second=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify({...payload,operation_cost_rate:0})])).rows[0];
assert.equal(Number((await db.query('select * from complete_manufacturing_order($1)',[second.order_id])).rows[0].total_cost),200);
const externalPayload={...payload,method:'external',supplier_id:supplier,external_mill_fee_per_kg:3,inputs:[{...payload.inputs[0],quantity:2}],outputs:[{output_kind:'main',product_id:plain,quality_id:plainQuality,quantity:1}]};
const external=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(externalPayload)])).rows[0];
assert.equal(Number((await db.query('select * from complete_manufacturing_order($1)',[external.order_id])).rows[0].total_cost),30);
const sacked=(await db.query("select create_product_with_pricing('SACKED','Sacked paddy',null,'KG',10,true,true) id")).rows[0].id;
const sackedQuality=(await db.query('select id from product_qualities where product_id=$1',[sacked])).rows[0].id;
await confirm([{product_id:sacked,quality_id:sackedQuality,location_id:loc,quantity:10,actual_price:10}],randomUUID(),{detailed:true,sacks:[{sack_count:2}]});
const sackPayload={...payload,operation_cost_rate:0,inputs:[{input_kind:'raw_material',product_id:sacked,quality_id:sackedQuality,quantity:5,sack_count:1}],outputs:[{output_kind:'main',product_id:plain,quality_id:plainQuality,quantity:4}]};
const sackOrder=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(sackPayload)])).rows[0];
await db.query('select * from complete_manufacturing_order($1)',[sackOrder.order_id]);
assert.equal(Number((await db.query('select sum(delta) balance from stock_sack_movements where product_id=$1',[sacked])).rows[0].balance),1);
await db.query('select * from complete_manufacturing_order($1)',[sackOrder.order_id]);
assert.equal(Number((await db.query('select sum(delta) balance from stock_sack_movements where product_id=$1',[sacked])).rows[0].balance),1);

const bag=(await db.query("select create_product_with_pricing('BAG','Bag',null,'UNIT',1) id")).rows[0].id;
const bagQuality=(await db.query('select id from product_qualities where product_id=$1',[bag])).rows[0].id;
const packed=(await db.query("select create_product_with_pricing('PACK','Packed rice',null,'UNIT',0) id")).rows[0].id;
const packedQuality=(await db.query('select id from product_qualities where product_id=$1',[packed])).rows[0].id;
await confirm([{product_id:bag,quality_id:bagQuality,location_id:loc,quantity:10,actual_price:1}]);
const riceLot=(await rows('purchase_lots')).find(l=>l.product_id===output).id;
const packing={center_id:center,location_id:loc,process_type:'packing',method:'own',rice_variety:'Standard',inputs:[{input_kind:'bulk_rice',product_id:output,quality_id:outputQuality,lot_id:riceLot,quantity:10}],outputs:[{output_kind:'packed',product_id:packed,quality_id:packedQuality,quantity:2,package_size_kg:5,packaging_product_id:bag,packaging_quality_id:bagQuality}]};
const packOrder=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(packing)])).rows[0];
await db.query('select * from complete_manufacturing_order($1)',[packOrder.order_id]);
assert.equal(await stock(bag),8);assert.equal(await stock(packed),2);assert.equal(await stock(output),20);
const badPacking=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify({...packing,rice_variety:'Wrong'})])).rows[0];
await assert.rejects(()=>db.query('select * from complete_manufacturing_order($1)',[badPacking.order_id]),/variety/);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
const manufacturingUser=randomUUID();await db.query('insert into auth.users(id) values($1)',[manufacturingUser]);
await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Production operator','center_user',array['dashboard','manufacturing'])",[manufacturingUser,org]);
await db.query("select set_config('test.user',$1,false)",[manufacturingUser]);await db.exec('set role authenticated');
assert.equal((await rows('manufacturing_orders')).length,0);
await assert.rejects(()=>db.query('select * from complete_manufacturing_order($1)',[clientId]),/stock center/);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
await db.query('insert into user_center_access(user_id,center_id) values($1,$2)',[manufacturingUser,center]);
await db.query("select set_config('test.user',$1,false)",[manufacturingUser]);await db.exec('set role authenticated');
assert.ok((await db.query('select * from stock_lot_balances()')).rows.length);
await db.query('select * from complete_manufacturing_order($1)',[clientId]);
assert.equal((await rows('stock_lot_allocations')).length,0,'Manufacturing RPC does not grant raw inventory ledger access');
// Stock remains usable when Manufacturing is not licensed to the business.
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key='manufacturing'",[org]);
await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
assert.equal(await stock(packed),2);
await assert.rejects(()=>db.query('select * from complete_manufacturing_order($1)',[clientId]),/Module access restricted/);
assert.equal((await db.query("select count(*)::int n from stock_movements where reference_type='packing_run'")).rows[0].n,3);
// No tenant can inspect or complete a foreign order.
await db.exec('reset role');await db.query("select set_config('test.user',$1,false)",[outsider]);await db.exec('set role authenticated');
assert.equal((await rows('manufacturing_orders')).length,0);
await assert.rejects(()=>db.query('select * from complete_manufacturing_order($1)',[saved.order_id]),/not found/);
await assert.rejects(()=>db.query('select * from save_manufacturing_order($1,$2::jsonb)',[saved.order_id,JSON.stringify(payload)]),/location|access|not found/);
await assert.rejects(()=>db.exec("update manufacturing_orders set status='completed'"),/permission denied/);
await db.exec('reset role');
assert.equal((await db.query("select m.id from stock_movements m left join stock_lot_allocations a on a.movement_id=m.id group by m.id having sum(a.quantity)<>case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then m.quantity else -m.quantity end")).rows.length,0);
console.log('PASS manufacturing drafts, client-id retries, completion retries, valuation after outbound stock, duplicate-lot overdraw rollback, packing/packaging, variety validation, inventory-only access, tenant isolation and ledger reconciliation');
await db.close();
