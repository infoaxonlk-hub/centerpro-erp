process.on("uncaughtException",e=>{console.error(e.stack,e.where??"",e.query??"");process.exit(1)});
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
for(const[id,oid]of[[admin,org],[outsider,otherOrg]]){await db.query("insert into auth.users(id) values($1)",[id]);await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Tester','admin',array['dashboard','purchases','sales','stock','stock_adjustment','masters','cash','labor','payment_reports','centers'])",[id,oid]);}
await db.query("insert into centers(id,organization_id,code,name,allow_multiple_locations) values($1,$2,'C','Center',true)",[center,org]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true),($3,$2,'SECOND','Second',false)",[loc,center,loc2]);
await db.query("insert into suppliers(id,organization_id,name) values($1,$2,'Supplier')",[supplier,org]);
await db.query("select set_config('test.user',$1,false)",[admin]);
await db.exec("set role authenticated");

const destinationCenter=randomUUID(),destinationLocation=randomUUID();
await db.query("insert into centers(id,organization_id,code,name) values($1,$2,'DEST','Destination')",[destinationCenter,org]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'OUT','Finished/by-product',true)",[destinationLocation,destinationCenter]);
async function product(code,unit='KG'){const id=(await db.query("select create_product_with_pricing($1,$1,null,$2,999,false,true) id",[code,unit])).rows[0].id;return{id,quality:(await db.query('select id from product_qualities where product_id=$1',[id])).rows[0].id};}
const raw=await product('PADDY'),rice=await product('RICE'),bran=await product('BRAN'),bag=await product('BAG','UNIT'),packed=await product('PACKED','UNIT');
async function buy(p,qty,price,number,target=center,location=loc){const r=(await db.query("select * from confirm_queued_purchase_with_lots($1,$2,$3,'BoM stock',$4::jsonb,$5::jsonb)",[randomUUID(),target,supplier,JSON.stringify([{product_id:p.id,quality_id:p.quality,location_id:location,quantity:qty,actual_price:price,lot_selection:{mode:'number',number}}]),JSON.stringify([{method:'credit',amount:qty*price}])])).rows[0];return(await db.query('select lot_id from purchase_lot_receipts where purchase_id=$1',[r.purchase_id])).rows[0].lot_id;}
const rawLot=await buy(raw,100,10,'RAW'),bagLot=await buy(bag,100,2,'BAGS');
const legacyRecipe=(await db.query('select * from save_manufacturing_recipe(null,$1::jsonb)',[JSON.stringify({name:'Legacy before conversion',process_type:'milling',operation_name:'Mill',operation_cost_basis:'per_hour',operation_cost_rate:5})])).rows[0];
const legacyData={center_id:center,location_id:loc,process_type:'milling',method:'own',recipe_id:legacyRecipe.recipe_id,operation_cost_basis:'per_hour',operation_cost_rate:5,operation_hours:1,inputs:[{input_kind:'raw_material',product_id:raw.id,quality_id:raw.quality,lot_id:rawLot,quantity:1}],outputs:[{output_kind:'main',product_id:rice.id,quality_id:rice.quality,quantity:1}]};
const legacyDraft=(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(legacyData)])).rows[0];
const config={recipe_code:'RICE-BOM',name:'Rice BoM',process_type:'milling',production_center_id:center,source_location_id:loc,finished_product_id:rice.id,finished_quality_id:rice.quality,finished_quantity:6,destination_center_id:center,destination_location_id:loc2,finished_cost_share:75,external_mill_fee_per_kg:0,
 components:[{product_id:raw.id,quality_id:raw.quality,quantity:10,input_kind:'raw_material'}],
 byproducts:[{product_id:bran.id,quality_id:bran.quality,quantity:2,destination_center_id:destinationCenter,destination_location_id:destinationLocation,cost_share_percent:25}],
 operations:[{name:'Milling hours',planned_quantity:1,cost_basis:'per_hour',cost_rate:5},{name:'Handling per kg',planned_quantity:10,cost_basis:'per_kg',cost_rate:1}]};
const saveBom=async(data,id=null)=>(await db.query('select save_manufacturing_bom($1,$2::jsonb) b',[id,JSON.stringify(data)])).rows[0].b;
let bom=await saveBom(config);assert.equal(bom.finished_unit,'KG');assert.equal(bom.manufacturing_bom_components.length,1);assert.equal(bom.manufacturing_bom_operations.length,2);
const scalar=async query=>Number((await db.query(query)).rows[0].n),stockCount=()=>scalar('select count(*) n from stock_movements');
const beforeDraft=await stockCount();assert.equal(await stockCount(),beforeDraft);
function request(b,q=12){const factor=q/Number(b.finished_quantity);return{recipe_id:b.id,bom_revision:b.revision,finished_product_id:b.finished_product_id,production_quantity:q,
 inputs:b.manufacturing_bom_components.map(x=>({bom_component_key:x.id,quantity:Number(x.quantity)*factor,source_selection:'lot',lot_id:x.input_kind==='packaging'?bagLot:rawLot,sack_count:0})),
 outputs:[{bom_output_key:'finished',quantity:q,sack_count:0},...b.manufacturing_bom_byproducts.map(x=>({bom_output_key:x.id,quantity:Number(x.quantity)*factor,sack_count:0}))],
 operations:b.manufacturing_bom_operations.map(x=>({bom_operation_key:x.id,actual_quantity:Number(x.planned_quantity)*factor}))};}
const saveOrder=async(data,id=randomUUID())=>(await db.query('select * from save_bom_manufacturing_order($1,$2::jsonb)',[id,JSON.stringify(data)])).rows[0];
const complete=async id=>(await db.query('select * from complete_manufacturing_order($1)',[id])).rows[0];
const actual=request(bom);actual.inputs[0].quantity=22;actual.outputs[1].quantity=3.5;actual.operations[0].actual_quantity=3;actual.operations[1].actual_quantity=999;
const saved=await saveOrder(actual);assert.equal(await stockCount(),beforeDraft);
const planned=(await db.query('select * from manufacturing_order_inputs where order_id=$1',[saved.order_id])).rows[0];assert.equal(Number(planned.planned_quantity),20);assert.equal(Number(planned.quantity),22);
// Editing the reusable BoM cannot alter an order's already-loaded plan/cost rules.
bom=await saveBom({...config,operations:[{...config.operations[0],cost_rate:500},{...config.operations[1],cost_rate:50}],components:[{...config.components[0],quantity:30}]},bom.id);
assert.equal(bom.revision,2);await saveOrder(actual,saved.order_id);
const done=await complete(saved.order_id);assert.equal(Number(done.total_cost),257); // 22*10 + 3*5 + 22*1, not caller-supplied rate/quantity.
const financial=(await db.query("select profit_loss_report('2020-01-01','2099-12-31') p")).rows[0].p;assert.equal(financial.cogs,0);assert.equal(financial.grossProfit,0);assert.equal(financial.closingInventory,1237);
assert.equal(Number((await db.query('select actual_quantity from manufacturing_order_operations where order_id=$1 and cost_basis=$2',[saved.order_id,'per_kg'])).rows[0].actual_quantity),22);
const out=(await db.query('select * from manufacturing_order_outputs where order_id=$1 order by output_kind',[saved.order_id])).rows;
assert.equal(out.find(x=>x.output_kind==='main').destination_location_id,loc2);assert.equal(out.find(x=>x.output_kind==='byproduct').destination_center_id,destinationCenter);
assert.equal((await db.query("select location_id,center_id from stock_movements where reference_id=$1 and movement_type='adjustment_in' order by product_id",[saved.order_id])).rows.length,2);
assert.equal(Number((await db.query('select sum(inventory_value) v from stock_movements where reference_id=$1 and center_id=$2 and location_id=$3',[saved.order_id,destinationCenter,destinationLocation])).rows[0].v),64.25);
const count=await stockCount();await complete(saved.order_id);assert.equal(await stockCount(),count);await saveOrder(actual,saved.order_id);assert.equal(await stockCount(),count);
await assert.rejects(()=>db.query('select * from save_manufacturing_order($1,$2::jsonb)',[saved.order_id,JSON.stringify({})]),/BoM/);
await assert.rejects(()=>saveBom({...config,recipe_code:'BAD-LOT',name:'Invalid lot template',components:[{...config.components[0],lot_id:rawLot}]}),/lots belong/);
await assert.rejects(()=>saveBom({...config,destination_location_id:destinationLocation}),/stock center\/location/);
await assert.rejects(()=>saveBom({...config,destination_center_id:randomUUID()}),/stock center\/location/);
await assert.rejects(()=>saveOrder({...request(bom),finished_product_id:bran.id}),/does not match/);
const wrongDestination=request(bom);wrongDestination.outputs[0].destination_location_id=randomUUID();await assert.rejects(()=>saveOrder(wrongDestination),/destination is fixed/);
const wrongRate=request(bom);wrongRate.operations[0].cost_rate=999;await assert.rejects(()=>saveOrder(wrongRate),/rates are fixed/);
const wrongProduct=request(bom);wrongProduct.inputs[0].product_id=bran.id;await assert.rejects(()=>saveOrder(wrongProduct),/identity is fixed/);
const inactive=await saveOrder(request(bom));const beforeInactive=await stockCount();
await db.query('update products set is_active=false where id=$1',[raw.id]);await assert.rejects(()=>complete(inactive.order_id),/must be active/);await db.query('update products set is_active=true where id=$1',[raw.id]);
await db.query('update product_qualities set is_active=false where id=$1',[raw.quality]);await assert.rejects(()=>complete(inactive.order_id),/must be active/);await db.query('update product_qualities set is_active=true where id=$1',[raw.quality]);
await db.query('update locations set is_active=false where id=$1',[loc2]);await assert.rejects(()=>complete(inactive.order_id),/active stock center\/location/);await db.query('update locations set is_active=true where id=$1',[loc2]);assert.equal(await stockCount(),beforeInactive);
const wrongLot=request(bom);wrongLot.inputs[0].lot_id=bagLot;await assert.rejects(()=>saveOrder(wrongLot),/lot does not belong/);
const short=request(bom);short.inputs[0].quantity=1000;const shortSaved=await saveOrder(short);await assert.rejects(()=>complete(shortSaved.order_id),/Insufficient/);assert.equal(await stockCount(),count);
const otherCenterLot=await buy(raw,10,50,'OTHER-CENTER',destinationCenter,destinationLocation);
const otherSource=request(bom);otherSource.inputs[0].lot_id=otherCenterLot;const otherSaved=await saveOrder(otherSource);const beforeInvalid=await stockCount();await assert.rejects(()=>complete(otherSaved.order_id),/Insufficient stock in selected lot/);assert.equal(await stockCount(),beforeInvalid);
const auto=request(bom);auto.inputs[0].source_selection='auto';auto.inputs[0].lot_id=null;const autoSaved=await saveOrder(auto);await assert.rejects(()=>complete(autoSaved.order_id),/Select the actual source lot/);
// Packing consumes explicit actual bag/rice components exactly once, with loss.
const packingConfig={...config,recipe_code:'PACK-BOM',name:'Pack BoM',process_type:'packing',finished_product_id:packed.id,finished_quality_id:packed.quality,finished_quantity:2,package_size_kg:5,finished_cost_share:100,byproducts:[],
 components:[{product_id:rice.id,quality_id:rice.quality,quantity:10,input_kind:'bulk_rice'},{product_id:bag.id,quality_id:bag.quality,quantity:2,input_kind:'packaging'}],operations:[{name:'Packing labor',planned_quantity:1,cost_basis:'per_hour',cost_rate:4}],production_center_id:center,source_location_id:loc2,destination_center_id:destinationCenter,destination_location_id:destinationLocation};
const packBom=await saveBom(packingConfig);const pack=request(packBom,2);pack.inputs[0].lot_id=out.find(x=>x.output_kind==='main').stock_lot_id;pack.inputs[0].quantity=10.5;pack.inputs[1].quantity=3;pack.inputs[1].source_selection='auto';pack.inputs[1].lot_id=null;pack.operations[0].actual_quantity=2;
// Bags are currently at source loc, move them to the packing source first.
await db.query("select create_stock_transfer($1,$2,$3,$2,$4,$5::jsonb,'Bag staging')",[randomUUID(),center,loc,loc2,JSON.stringify([{product_id:bag.id,quality_id:bag.quality,quantity:10}])]);
pack.inputs[1].source_selection='lot';pack.inputs[1].lot_id=bagLot;
const packSaved=await saveOrder(pack);await complete(packSaved.order_id);
const packOrder=(await db.query('select * from manufacturing_orders where id=$1',[packSaved.order_id])).rows[0];assert.equal(Number(packOrder.process_loss_kg),0.5);
assert.equal((await db.query('select * from manufacturing_order_inputs where order_id=$1',[packSaved.order_id])).rows.length,2);
assert.ok(Math.abs(Number(packOrder.total_cost)-(192.75/12*10.5+3*2+8))<0.000001);
assert.equal((await db.query("select center_id,location_id from stock_movements where reference_id=$1 and movement_type='adjustment_in'",[packSaved.order_id])).rows[0].center_id,destinationCenter);
await saveBom({...config,recipe_code:legacyRecipe.recipe_code,name:'Converted legacy preset'},legacyRecipe.recipe_id);
await db.query('select * from save_manufacturing_order($1,$2::jsonb)',[legacyDraft.order_id,JSON.stringify(legacyData)]);
assert.equal(Number((await complete(legacyDraft.order_id)).total_cost),15);
assert.equal((await db.query("select location_id from stock_movements where reference_id=$1 and movement_type='adjustment_in'",[legacyDraft.order_id])).rows[0].location_id,loc);
// Zero actual by-product is retained for audit, without a zero-quantity receipt.
const zeroBom=await saveBom({...config,recipe_code:'ZERO-BYPRODUCT',name:'Optional by-product',finished_cost_share:0,byproducts:[{...config.byproducts[0],cost_share_percent:0}]});
const zero=request(zeroBom,6);zero.outputs[1].quantity=0;const zeroOrder=await saveOrder(zero);await complete(zeroOrder.order_id);
assert.equal((await db.query("select count(*)::int n from stock_movements where reference_id=$1 and movement_type='adjustment_in'",[zeroOrder.order_id])).rows[0].n,1);
const rawBalance=Number((await db.query('select sum(available_quantity) q from stock_lot_valuations() where product_id=$1 and center_id=$2 and location_id=$3',[raw.id,center,loc])).rows[0].q);
await db.query("select create_stock_adjustment($1,$2,$3,$4,$5,$6,null,'Legacy source setup')",[randomUUID(),center,loc,raw.id,raw.quality,rawBalance+3]);
const legacy=request(zeroBom,6);legacy.inputs[0].source_selection='legacy';legacy.inputs[0].lot_id=null;legacy.inputs[0].quantity=2;legacy.outputs[1].quantity=0;
const legacySaved=await saveOrder(legacy);assert.equal(Number((await complete(legacySaved.order_id)).total_cost),27);
assert.equal((await db.query("select a.lot_id from stock_lot_allocations a join stock_movements m on m.id=a.movement_id where m.reference_id=$1 and m.movement_type='adjustment_out'",[legacySaved.order_id])).rows[0].lot_id,null);
const shortLegacy=await saveOrder(legacy);await assert.rejects(()=>complete(shortLegacy.order_id),/Insufficient valued lot stock/);
await assert.rejects(()=>db.query('select * from save_manufacturing_order_legacy($1,$2::jsonb)',[randomUUID(),'{}']),/permission denied/);
await assert.rejects(()=>db.query('select * from save_manufacturing_recipe_legacy(null,$1::jsonb)',['{}']),/permission denied/);
await assert.rejects(()=>db.query("insert into manufacturing_bom_components(organization_id,recipe_id,product_id,quality_id,quantity,unit,input_kind,sequence) values($1,$2,$3,$4,1,'KG','raw_material',99)",[org,bom.id,raw.id,raw.quality]),/permission denied/);
await db.exec('reset role');await assert.rejects(()=>db.query('update manufacturing_order_operations set cost_rate=999 where order_id=$1',[saved.order_id]),/immutable/);
await db.query("select set_config('test.user','',false)");const scoped=randomUUID();await db.query('insert into auth.users(id) values($1)',[scoped]);await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Scoped','center_user',array['dashboard','stock','manufacturing'])",[scoped,org]);await db.query('insert into user_center_access(user_id,center_id) values($1,$2)',[scoped,center]);await db.query("select set_config('test.user',$1,false)",[scoped]);await db.exec('set role authenticated');
assert.equal((await db.query('select * from manufacturing_recipes where finished_product_id is not null')).rows.length,0);await assert.rejects(()=>saveOrder(request(bom)),/authorized centers/);
await db.exec('reset role');
await db.query("select set_config('test.user',$1,false)",[outsider]);await db.exec('set role authenticated');
assert.equal((await db.query('select * from manufacturing_bom_components')).rows.length,0);await assert.rejects(()=>saveOrder(actual),/BoM|access/i);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key='manufacturing'",[org]);await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
await assert.rejects(()=>saveBom(config),/module|access|disabled/i);assert.equal((await db.query('select * from manufacturing_bom_components')).rows.length,0);
await db.close();console.log('PASS reusable milling/packing BoMs, snapshot revisions, scaled plans, actual consumption/operations, destination centers, actual lot costing/loss, draft/retry atomicity, invalid source/location, immutability and tenant/module guards.');
