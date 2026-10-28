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
const request=randomUUID(),first=await confirm([line()],request);
assert.equal(await count('purchase_lots'),1);assert.equal(await count('purchase_lot_receipts'),1);
const initial=(await rows('purchase_lot_receipts'))[0],lot=(await rows('purchase_lots'))[0];
assert.match(lot.lot_number,/^LOT-\d{8}-\d+/);assert.equal(Number(initial.received_quantity),10);assert.equal(Number(initial.unit_purchase_price),10);
assert.equal((await confirm([line(999,99,{mode:'number',number:'CHANGED'})],request)).purchase_id,first.purchase_id);
assert.equal(await count('purchase_lots'),1);assert.equal(await count('purchase_lot_receipts'),1);
const second=await confirm([line(5,12,{mode:'existing',lot_id:lot.id})]);
const third=await confirm([line(3,15,{mode:'number',number:'  '+lot.lot_number.toLowerCase()+'  '})]);
assert.equal(await count('purchase_lots'),1);
assert.deepEqual((await rows('purchase_lot_receipts')).map(r=>Number(r.unit_purchase_price)).sort((a,b)=>a-b),[10,12,15]);
assert.equal(Number((await db.query("select unit_cost from stock_movements where reference_id=$1",[first.purchase_id])).rows[0].unit_cost),10);
assert.equal(Number((await db.query("select total_amount from purchase_orders where id=$1",[second.purchase_id])).rows[0].total_amount),60);
const split=await confirm([line(4,10,{mode:'number',number:'SPLIT-A'}),{...line(6,10,{mode:'number',number:'SPLIT-B'}),location_id:loc2}]);
const splitReceipts=(await rows('purchase_lot_receipts')).filter(r=>r.purchase_id===split.purchase_id);
assert.equal(splitReceipts.reduce((n,r)=>n+Number(r.received_quantity),0),10);assert.equal(new Set(splitReceipts.map(r=>r.location_id)).size,2);
await assert.rejects(()=>db.query("select * from confirm_queued_purchase($1,$2,$3,'Bypass',$4::jsonb,$5::jsonb)",[randomUUID(),center,supplier,JSON.stringify([line()]),JSON.stringify([{method:'credit',amount:100}])]),/lot assignments/i);
const before=[await count('purchase_lots'),await count('purchase_orders'),await count('stock_movements'),await count('supplier_payables')];
await assert.rejects(()=>confirm([line(1,10,{mode:'number',number:'ROLLBACK'}),line(1,10,{mode:'existing',lot_id:randomUUID()})]),/does not belong/i);
assert.deepEqual([await count('purchase_lots'),await count('purchase_orders'),await count('stock_movements'),await count('supplier_payables')],before);
const plainPurchase=await confirm([{product_id:plain,quality_id:plainQuality,location_id:loc,quantity:1,actual_price:10}]);
assert.ok(plainPurchase.purchase_id);assert.equal(await count('purchase_lot_receipts'),5);
await assert.rejects(()=>confirm([{...line(),quality_id:plainQuality}]),/product|quality/i);
await assert.rejects(()=>confirm([line(1,10,{mode:'number',number:'  '})]),/lot number/i);
await assert.rejects(()=>confirm([line(1,10,{mode:'invalid'})]),/selection mode/i);
await assert.rejects(()=>confirm([line(1,10,{mode:'existing',lot_id:lot.id}),{product_id:plain,quality_id:plainQuality,location_id:loc,quantity:1,actual_price:10,lot_selection:{mode:'existing',lot_id:lot.id}}]),/tracking is disabled/i);
await db.exec("reset role");
await assert.rejects(()=>db.query("update purchase_lot_receipts set unit_purchase_price=999 where id=$1",[initial.id]),/immutable/i);
await assert.rejects(()=>db.query("update purchase_lots set lot_number='RENAMED' where id=$1",[lot.id]),/immutable/i);
await assert.rejects(()=>db.query("update purchase_order_lines set location_id=$1 where id=$2",[loc2,initial.purchase_line_id]),/immutable/i);
await db.query("select set_config('test.user','',false)");
await db.query("insert into purchase_lots(organization_id,product_id,quality_id,lot_number,created_by) values($1,$2,$3,'OTHER-QUALITY',$4)",[org,plain,plainQuality,admin]);
const wrong=(await db.query("select id from purchase_lots where lot_number='OTHER-QUALITY'")).rows[0].id;
await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec("set role authenticated");
await assert.rejects(()=>confirm([line(1,10,{mode:'existing',lot_id:wrong})]),/does not belong/i);
const sackProduct=(await db.query("select create_product_with_pricing('SACKLOT','Sack lot',null,'KG',10,true,true) id")).rows[0].id;
const sackQuality=(await db.query("select id from product_qualities where product_id=$1",[sackProduct])).rows[0].id;
const session=(await db.query("insert into labor_sessions(organization_id,center_id,title,operation,created_by) values($1,$2,'Lot labor','purchase',$3) returning id",[org,center,admin])).rows[0].id;
const detailedRequest=randomUUID();
const detailed=await confirm([{product_id:sackProduct,quality_id:sackQuality,location_id:loc,quantity:4,actual_price:10},{product_id:sackProduct,quality_id:sackQuality,location_id:loc,quantity:6,actual_price:12}],detailedRequest,{detailed:true,sacks:[{sack_count:1},{sack_count:2}],session,loads:2});
assert.equal((await db.query("select labor_session_id from purchase_orders where id=$1",[detailed.purchase_id])).rows[0].labor_session_id,session);
assert.equal(Number((await db.query("select sum(delta) n from stock_sack_movements where product_id=$1",[sackProduct])).rows[0].n),3);
assert.equal((await db.query("select count(*)::int n from purchase_lot_receipts where purchase_id=$1",[detailed.purchase_id])).rows[0].n,2);

await db.query("update labor_sessions set status='closed' where id=$1",[session]);
assert.equal((await confirm([],detailedRequest,{session})).purchase_id,detailed.purchase_id);
const beforeCash=[await count('purchase_orders'),await count('purchase_lots'),await count('purchase_lot_receipts')];
await assert.rejects(()=>db.query("select * from confirm_queued_purchase_with_lots($1,$2,$3,'No cash',$4::jsonb,$5::jsonb)",[randomUUID(),center,supplier,JSON.stringify([line()]),JSON.stringify([{method:'cash',amount:100}])]),/cash balance/i);
assert.deepEqual([await count('purchase_orders'),await count('purchase_lots'),await count('purchase_lot_receipts')],beforeCash);
await assert.rejects(()=>db.query("insert into purchase_lots(organization_id,product_id,quality_id,lot_number,created_by) values($1,$2,$3,'CLIENT-WRITE',$4)",[org,product,quality,admin]),/permission denied/i);
const cancelled=await confirm([line(2,10,{mode:'number',number:'CANCELLED-RECEIPT'})]);
const cancellation=(await db.query("select request_bill_cancellation('purchase',$1,'Test lot history') id",[cancelled.purchase_id])).rows[0].id;
await db.query("select review_bill_cancellation($1,true,'Approved')",[cancellation]);
assert.equal(Number((await db.query("select received_quantity from purchase_lot_receipts where purchase_id=$1",[cancelled.purchase_id])).rows[0].received_quantity),2);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
const foreignProduct=randomUUID(),foreignQuality=randomUUID(),foreignLot=randomUUID();
await db.query("insert into products(id,organization_id,code,name) values($1,$2,'OTHER','Other business')",[foreignProduct,otherOrg]);
await db.query("insert into product_qualities(id,product_id,name,default_price) values($1,$2,'Standard',10)",[foreignQuality,foreignProduct]);
await db.query("insert into purchase_lots(id,organization_id,product_id,quality_id,lot_number,created_by) values($1,$2,$3,$4,'FOREIGN',$5)",[foreignLot,otherOrg,foreignProduct,foreignQuality,outsider]);
await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec("set role authenticated");
await assert.rejects(()=>confirm([line(1,10,{mode:'existing',lot_id:foreignLot})]),/does not belong/i);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
const staff=randomUUID();await db.query("insert into auth.users(id) values($1)",[staff]);
await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'No centers','center_user',array['dashboard','purchases'])",[staff,org]);
await db.query("select set_config('test.user',$1,false)",[staff]);await db.exec("set role authenticated");
assert.equal(await count('purchase_lot_receipts'),0);await assert.rejects(()=>confirm([line()]),/access/i);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
await db.query("update profiles set permissions=array['dashboard'] where id=$1",[staff]);
await db.query("select set_config('test.user',$1,false)",[staff]);await db.exec("set role authenticated");assert.equal(await count('purchase_lots'),0);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key='purchases'",[org]);
await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec("set role authenticated");
assert.equal(await count('purchase_lots'),0);await assert.rejects(()=>confirm([line()]),/module|access|restricted/i);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
await db.query("update business_module_entitlements set enabled=true where organization_id=$1 and module_key='purchases'",[org]);
await db.query("update business_subscriptions set status='expired' where organization_id=$1",[org]);
await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec("set role authenticated");
assert.equal(await count('purchase_lots'),0);await assert.rejects(()=>confirm([line()]),/subscription|expired|access/i);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
await db.query("update business_subscriptions set status='active' where organization_id=$1",[org]);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
await db.query("update profiles set permissions=array['dashboard'] where id=$1",[outsider]);
await db.query("select set_config('test.user',$1,false)",[outsider]);await db.exec("set role authenticated");
assert.equal(await count('purchase_lots'),0);assert.equal(await count('purchase_lot_receipts'),0);
await assert.rejects(()=>confirm([line()]),/access|permission/i);
await db.exec("reset role");await db.query("select set_config('test.user','',false)");
await db.query("update organizations set business_status='suspended' where id=$1",[org]);
await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec("set role authenticated");
assert.equal(await count('purchase_lots'),0);assert.equal(await count('purchase_lot_receipts'),0);
await assert.rejects(()=>confirm([line()]),/business|suspend|access/i);
console.log('PASS lot defaults, auto/manual/reuse, split receipts, immutable costs/assignments, rollback, bypass prevention, idempotent offline retry, sack/labor/cost preservation, tenant and subscription guards.');
await db.close();
