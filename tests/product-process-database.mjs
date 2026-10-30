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
  .filter(name=>name.endsWith(".sql")&&!name.includes("verify")&&Number(name.slice(0,3))<54).sort()) {
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

const beforeMigration=(await db.query("select create_product_with_pricing('BEFORE','Existing product',null,'KG',10) id")).rows[0].id;
const beforeQuality=(await db.query('select id from product_qualities where product_id=$1',[beforeMigration])).rows[0].id;
const historicalLines=[1,2].map(quantity=>({product_id:beforeMigration,quality_id:beforeQuality,location_id:loc,quantity,actual_price:10}));
const historical=(await db.query("select * from confirm_queued_purchase_with_lots($1,$2,$3,'Historical',$4::jsonb,$5::jsonb)",[randomUUID(),center,supplier,JSON.stringify(historicalLines),JSON.stringify([{method:'credit',amount:30}])])).rows[0];
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
for(const name of ['054_product_process_and_single_purchase_receipt.sql','055_purchase_multiple_weighings_single_lot.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
assert.deepEqual((await db.query('select can_be_sold,can_be_purchased,can_be_manufactured from products where id=$1',[beforeMigration])).rows[0],{can_be_sold:true,can_be_purchased:true,can_be_manufactured:true});
assert.equal((await db.query('select count(*)::int n from purchase_order_lines where purchase_order_id=$1',[historical.purchase_id])).rows[0].n,2);
// The migration must not make historical split receipts impossible to reverse.
await db.query('update products set can_be_purchased=false where id=$1',[beforeMigration]);
const historicalLine=(await db.query('select id from purchase_order_lines where purchase_order_id=$1 order by quantity',[historical.purchase_id])).rows[0].id;
const historicalReturn=(await db.query("select request_bill_return('purchase',$1,'Historical after flag change',$2::jsonb) id",[historical.purchase_id,JSON.stringify([{line_id:historicalLine,quantity:1}])])).rows[0].id;
await db.query("select review_bill_return($1,true,'Approved')",[historicalReturn]);

const create=async(code,sold,purchased,manufactured)=>(await db.query("select create_product_with_pricing($1,$1,null,'KG',10,false,true,20,'AVCO',$2,$3,$4) id",[code,sold,purchased,manufactured])).rows[0].id;
const qualityFor=async id=>(await db.query('select id from product_qualities where product_id=$1',[id])).rows[0].id;
const lineFor=async(id,quantity=10)=>({product_id:id,quality_id:await qualityFor(id),location_id:loc,quantity,actual_price:10});
async function purchase(lines,request=randomUUID()){
 return(await db.query("select * from confirm_queued_purchase_with_lots($1,$2,$3,'Process test',$4::jsonb,$5::jsonb)",[request,center,supplier,JSON.stringify(lines),JSON.stringify([{method:'credit',amount:lines.reduce((s,l)=>s+l.quantity*l.actual_price,0)}])])).rows[0];
}
async function sell(id){return db.query("select confirm_center_sale($1,$2,null,'Process test',$3::jsonb,$4::jsonb)",[randomUUID(),center,JSON.stringify([{...await lineFor(id,1),unit_price:20}]),JSON.stringify([{method:'cash',amount:20}])]);}
async function editFlags(id,sold,purchased,manufactured){return db.query("select edit_product_defaults($1,p.code,p.name,null,p.unit_of_measure,p.tracks_sacks,p.tracks_purchase_lots,p.default_sales_price,p.costing_method,'[]',$2,$3,$4) from products p where p.id=$1",[id,sold,purchased,manufactured]);}
const products=[];
for(let mask=0;mask<8;mask++){
 const expected={can_be_sold:!!(mask&1),can_be_purchased:!!(mask&2),can_be_manufactured:!!(mask&4)};
 const id=await create('FLAGS'+mask,...Object.values(expected));products.push(id);
 assert.deepEqual((await db.query('select can_be_sold,can_be_purchased,can_be_manufactured from products where id=$1',[id])).rows[0],expected);
 // Every combination also round trips through the edit RPC.
 await editFlags(id,...Object.values(expected));
 assert.deepEqual((await db.query('select can_be_sold,can_be_purchased,can_be_manufactured from products where id=$1',[id])).rows[0],expected);
 if(expected.can_be_purchased)await purchase([await lineFor(id)]);
 else await assert.rejects(()=>purchasePending(id),/cannot be purchased/);
 // Stock adjustments can provide manufacturing/sold-only stock without making it purchasable.
 await db.query("select create_stock_adjustment($1,$2,$3,$4,$5,20,10,'Process fixture')",[randomUUID(),center,loc,id,await qualityFor(id)]);
 if(expected.can_be_sold)await sell(id);else await assert.rejects(()=>sell(id),/cannot be sold/);
}
async function purchasePending(id){return purchase([await lineFor(id)]);}
const legacy=(await db.query("select create_product_with_pricing('LEGACY','Legacy client',null,'KG',10) id")).rows[0].id;
assert.deepEqual((await db.query('select can_be_sold,can_be_purchased,can_be_manufactured from products where id=$1',[legacy])).rows[0],{can_be_sold:true,can_be_purchased:true,can_be_manufactured:true});
const manufactured=products[4],purchased=products[2],sold=products[1];
const reversedSale=(await sell(sold)).rows[0].confirm_center_sale;
await editFlags(sold,false,false,false);
const cancelSale=(await db.query("select request_bill_cancellation('sale',$1,'Historical sale flag change') id",[reversedSale])).rows[0].id;
await db.query("select review_bill_cancellation($1,true,'Approved')",[cancelSale]);
await editFlags(sold,true,false,false);
const request=randomUUID(),receipt=await purchase([await lineFor(purchased,3),await lineFor(products[3],4)],request);
assert.equal((await purchase([],request)).purchase_id,receipt.purchase_id);
const receipts=(await db.query('select * from purchase_lot_receipts where purchase_id=$1',[receipt.purchase_id])).rows;
assert.equal(receipts.length,2);assert.equal(new Set(receipts.map(r=>r.product_id)).size,2);
assert.deepEqual(receipts.map(r=>Number(r.received_quantity)).sort(),[3,4]);
assert.equal((await db.query('select count(*)::int n from stock_movements where reference_id=$1',[receipt.purchase_id])).rows[0].n,2);
const before=(await db.query('select (select count(*) from purchase_orders) orders,(select count(*) from purchase_lots) lots,(select count(*) from stock_movements) moves')).rows[0];
const l=await lineFor(purchased,1);
await assert.rejects(()=>purchase([{...l,lot_selection:{mode:'number',number:'A'}},{...l,location_id:loc2,lot_selection:{mode:'number',number:'B'}}]),/one quality and one lot/);
const extraQuality=(await db.query("insert into product_qualities(product_id,name,default_price) values($1,'Extra',10) returning id",[purchased])).rows[0].id;
await assert.rejects(()=>purchase([l,{...l,quality_id:extraQuality}]),/one quality and one lot/);
assert.deepEqual((await db.query('select (select count(*) from purchase_orders) orders,(select count(*) from purchase_lots) lots,(select count(*) from stock_movements) moves')).rows[0],before);
// Old purchase RPC also cannot bypass the line trigger.
await assert.rejects(async()=>db.query("select * from confirm_queued_purchase($1,$2,$3,'Bypass',$4::jsonb,$5::jsonb)",[randomUUID(),center,supplier,JSON.stringify([await lineFor(manufactured)]),JSON.stringify([{method:'credit',amount:100}])]),/cannot be purchased/);
// An earlier saved draft must be checked again after process flags change.
const draft=(await db.query("insert into purchase_orders(organization_id,center_id,supplier_id,po_number,status,payment_method,created_by) values($1,$2,$3,'FLAG-DRAFT','draft','credit',$4) returning id",[org,center,supplier,admin])).rows[0].id;
await db.query('insert into purchase_order_lines(purchase_order_id,product_id,quality_id,location_id,quantity,system_price,actual_price) values($1,$2,$3,$4,1,10,10)',[draft,purchased,await qualityFor(purchased),loc]);
await assert.rejects(()=>db.query('insert into purchase_order_lines(purchase_order_id,product_id,quality_id,location_id,quantity,system_price,actual_price) values($1,$2,$3,$4,1,10,10)',[draft,purchased,extraQuality,loc2]),/one quality and one lot/);
await editFlags(purchased,false,false,false);
await assert.rejects(()=>db.query("update purchase_orders set status='confirmed' where id=$1",[draft]),/cannot be purchased/);
await editFlags(purchased,false,true,false);

const production={center_id:center,location_id:loc,process_type:'milling',method:'own',operation_cost_basis:'per_kg',operation_cost_rate:0,inputs:[{input_kind:'raw_material',product_id:manufactured,quality_id:await qualityFor(manufactured),quantity:2}],outputs:[{output_kind:'main',product_id:products[5],quality_id:await qualityFor(products[5]),quantity:1}]};
const save=async payload=>(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(payload)])).rows[0];
const order=await save(production);await db.query('select * from complete_manufacturing_order($1)',[order.order_id]);
await db.query('select * from complete_manufacturing_order($1)',[order.order_id]);
const soldInput={...production.inputs[0],product_id:sold,quality_id:await qualityFor(sold)};
await assert.rejects(()=>save({...production,inputs:[soldInput]}),/inputs must/);
const badOutput={...production.outputs[0],product_id:purchased,quality_id:await qualityFor(purchased)};
await assert.rejects(()=>save({...production,outputs:[badOutput]}),/cannot be manufactured/);
const later=await save(production);await editFlags(products[5],true,false,false);
const movesBefore=(await db.query('select count(*)::int n from stock_movements')).rows[0].n;
await assert.rejects(()=>db.query('select * from complete_manufacturing_order($1)',[later.order_id]),/cannot be manufactured/);
assert.equal((await db.query('select count(*)::int n from stock_movements')).rows[0].n,movesBefore);
await editFlags(products[5],true,false,true);

await db.exec('reset role');await db.query("select set_config('test.user','',false)");
await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key='purchases'",[org]);await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
await assert.rejects(()=>purchase([l]),/module|access|disabled/i);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");await db.query("update business_module_entitlements set enabled=true where organization_id=$1 and module_key='purchases'",[org]);
await db.query("update profiles set permissions=array['dashboard'],role='center_user' where id=$1",[admin]);await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
await assert.rejects(()=>purchase([l]),/permission|access/i);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");await db.query("update profiles set role='admin',permissions=array['dashboard','purchases','sales','stock','masters'] where id=$1",[admin]);
await db.query("select set_config('test.user',$1,false)",[outsider]);await db.exec('set role authenticated');
await assert.rejects(()=>purchase([l]),/access|business|center|product/i);
await assert.rejects(()=>db.query("select edit_product_defaults($1,'ATTACK','Attack',null,'KG',false,true,null,'AVCO','[]',true,true,true)",[manufactured]),/not found/);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
await db.query("update organizations set business_status='suspended' where id=$1",[org]);await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
await assert.rejects(()=>purchase([l]),/suspend|access|business/i);
await db.close();
console.log('PASS all eight product process combinations, atomic edits, sales/purchase/manufacturing guards, single receipt, split rollback, offline retry identity, draft flag recheck, tenant/module/role/subscription enforcement.');
