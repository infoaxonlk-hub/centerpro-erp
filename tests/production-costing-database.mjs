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
for(const[id,oid]of[[admin,org],[outsider,otherOrg]]){await db.query("insert into auth.users(id) values($1)",[id]);await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Tester','admin',array['dashboard','purchases','sales','stock','stock_adjustment','masters','cash','labor','payment_reports'])",[id,oid]);}
await db.query("insert into centers(id,organization_id,code,name,allow_multiple_locations) values($1,$2,'C','Center',true)",[center,org]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true),($3,$2,'SECOND','Second',false)",[loc,center,loc2]);
await db.query("insert into suppliers(id,organization_id,name) values($1,$2,'Supplier')",[supplier,org]);
await db.query("select set_config('test.user',$1,false)",[admin]);
await db.exec("set role authenticated");


async function product(code){const id=(await db.query("select create_product_with_pricing($1,$1,null,'KG',999,false,true) id",[code])).rows[0].id;return{id,quality:(await db.query('select id from product_qualities where product_id=$1',[id])).rows[0].id};}
const raw=await product('RAW'),rice=await product('RICE'),bran=await product('BRAN'),bags=await product('BAG'),packed=await product('PACK'),fractional=await product('FRACTION');
async function buy(p,qty,price,number){return(await db.query("select * from confirm_queued_purchase_with_lots($1,$2,$3,'Cost test',$4::jsonb,$5::jsonb)",[randomUUID(),center,supplier,JSON.stringify([{product_id:p.id,quality_id:p.quality,location_id:loc,quantity:qty,actual_price:price,lot_selection:{mode:'number',number}}]),JSON.stringify([{method:'credit',amount:qty*price}])])).rows[0];}
await buy(raw,10,10,'CHEAP');await buy(raw,10,30,'EXPENSIVE');await buy(bags,10,2,'BAGS');
const lot=async number=>(await db.query('select id from purchase_lots where lot_number=$1',[number])).rows[0].id;
const input=(p,quantity,lot_id)=>({input_kind:'raw_material',product_id:p.id,quality_id:p.quality,quantity,lot_id});
const output=(p,quantity,cost_share_percent=0)=>({output_kind:'main',product_id:p.id,quality_id:p.quality,quantity,cost_share_percent});
const base={center_id:center,location_id:loc,process_type:'milling',method:'own',operation_cost_basis:'per_hour',operation_cost_rate:5,operation_hours:2,inputs:[input(raw,4,await lot('EXPENSIVE'))],outputs:[output(rice,3,75),{...output(bran,1,25),output_kind:'byproduct'}]};
const save=async data=>(await db.query('select * from save_manufacturing_order(null,$1::jsonb)',[JSON.stringify(data)])).rows[0].order_id;
const complete=async id=>(await db.query('select * from complete_manufacturing_order($1)',[id])).rows[0];
const n=async(table)=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
const value=async() =>Number((await db.query("select sum(case when movement_type in ('purchase_in','transfer_in','adjustment_in') then inventory_value else -inventory_value end) v from stock_movements")).rows[0].v);
const report=async()=>(await db.query("select profit_loss_report('2020-01-01','2099-12-31') r")).rows[0].r;
const openingValue=await value(),openingMoves=await n('stock_movements');
const order=await save(base);assert.equal(await n('manufacturing_cost_entries'),0);assert.equal(await n('stock_movements'),openingMoves);assert.equal((await report()).cogs,0);
const finished=await complete(order);assert.equal(Number(finished.total_cost),130); // 4*30, NOT product default 999 or pooled average 20.
assert.equal(await value(),openingValue+10);assert.equal((await report()).cogs,0);
const produced=(await db.query('select * from manufacturing_order_outputs where order_id=$1 order by quantity desc',[order])).rows;
assert.equal(Number(produced[0].line_cost),97.5);assert.equal(Number(produced[0].unit_cost),32.5);assert.equal(Number(produced[1].line_cost),32.5);
assert.equal(produced.reduce((s,x)=>s+Number(x.line_cost),0),130);assert.ok(produced.every(x=>x.stock_lot_id&&x.stock_movement_id));
const costCount=await n('manufacturing_cost_entries');await complete(order);assert.equal(await n('manufacturing_cost_entries'),costCount);assert.equal(Number((await complete(order)).total_cost),130);
async function sell(p,quantity,price=100){return(await db.query("select confirm_center_sale($1,$2,null,'Cost sale',$3::jsonb,$4::jsonb) id",[randomUUID(),center,JSON.stringify([{product_id:p.id,quality_id:p.quality,location_id:loc,quantity,unit_price:price}]),JSON.stringify([{method:'cash',amount:quantity*price}])])).rows[0].id;}
const sale=await sell(rice,1);let pnl=await report();assert.equal(pnl.revenue,100);assert.equal(pnl.cogs,32.5);assert.equal(pnl.grossProfit,67.5);assert.equal(pnl.operatingExpenses,0);assert.equal(pnl.netProfit,67.5);
const riceLeft=(await db.query('select * from stock_lot_valuations() where product_id=$1',[rice.id])).rows[0];assert.equal(Number(riceLeft.available_quantity),2);assert.equal(Number(riceLeft.inventory_value),65);
assert.equal(Number((await db.query('select cogs_value from sales_order_lines where sales_order_id=$1',[sale])).rows[0].cogs_value),32.5);
const saleLine=(await db.query('select id from sales_order_lines where sales_order_id=$1',[sale])).rows[0].id;
const ret=(await db.query("select request_bill_return('sale',$1,'Cost reversal',$2::jsonb) id",[sale,JSON.stringify([{line_id:saleLine,quantity:1}])])).rows[0].id;
await db.query("select review_bill_return($1,true,'Approved')",[ret]);pnl=await report();assert.equal(pnl.revenue,0);assert.equal(pnl.cogs,0);
// One recorded labor expense replaces, rather than adds to, the configured rate.
const category=(await db.query("insert into expense_categories(organization_id,code,name) values($1,'PROD','Production') returning id",[org])).rows[0].id;
const expense=async amount=>(await db.query("select create_center_expense($1,$2,current_date,'Mill service',$3,'credit') id",[center,category,amount])).rows[0].id;
const laborExpense=await expense(12),externalExpense=await expense(7);
const external=await save({...base,method:'external',supplier_id:supplier,operation_expense_id:laborExpense,external_expense_id:externalExpense,operation_hours:99,external_mill_fee_per_kg:999,inputs:[input(raw,2,await lot('EXPENSIVE'))],outputs:[output(rice,1)]});
assert.equal(Number((await complete(external)).total_cost),79);assert.equal((await report()).operatingExpenses,0);assert.equal(await n('expenses'),2);
const entries=(await db.query('select * from manufacturing_cost_entries where order_id=$1',[external])).rows;assert.equal(entries.filter(x=>x.expense_id).length,2);assert.equal(entries.reduce((s,x)=>s+Number(x.amount),0),79);
await db.exec('reset role');await assert.rejects(()=>db.query('update expenses set amount=20 where id=$1',[laborExpense]),/immutable/);await db.exec('set role authenticated');
const duplicated=await save({...base,operation_expense_id:laborExpense,inputs:[input(raw,1,await lot('EXPENSIVE'))],outputs:[output(rice,1)]});
const beforeFail=await value(),beforeCount=await n('stock_movements');await assert.rejects(()=>complete(duplicated),/already been capitalized/);assert.equal(await value(),beforeFail);assert.equal(await n('stock_movements'),beforeCount);
// Packing: exact bulk cost + bag stock + hourly labor, with six-decimal residual.
const riceLot=produced[0].stock_lot_id;
const packing=await save({center_id:center,location_id:loc,process_type:'packing',method:'own',rice_variety:'Standard',operation_cost_basis:'per_hour',operation_cost_rate:3,operation_hours:2,inputs:[{...input(rice,2,riceLot),input_kind:'bulk_rice'}],outputs:[{...output(packed,2),output_kind:'packed',package_size_kg:1,packaging_product_id:bags.id,packaging_quality_id:bags.quality}]});
assert.equal(Number((await complete(packing)).total_cost),75); // 65 rice + 4 bags + 6 labor.
const packedLine=(await db.query('select * from manufacturing_order_outputs where order_id=$1',[packing])).rows[0];assert.equal(Number(packedLine.unit_cost),37.5);
await sell(packed,1,80);pnl=await report();assert.equal(pnl.cogs,37.5);assert.equal(pnl.grossProfit,42.5);
const cancelSold=await sell(packed,1,80),cancelRequest=(await db.query("select request_bill_cancellation('sale',$1,'Exact cost cancellation') id",[cancelSold])).rows[0].id;
await db.query("select review_bill_cancellation($1,true,'Approved')",[cancelRequest]);assert.equal((await report()).cogs,37.5);assert.equal((await report()).revenue,80);
const beforeTransfer=await value(),beforeTransferCogs=(await report()).cogs,transferId=randomUUID();
await db.query("select create_stock_transfer($1,$2,$3,$2,$4,$5::jsonb,'Valued transfer')",[transferId,center,loc,loc2,JSON.stringify([{product_id:rice.id,quality_id:rice.quality,quantity:1}])]);
assert.equal(await value(),beforeTransfer);assert.equal((await report()).cogs,beforeTransferCogs);
assert.equal(Number((await db.query('select total_value from stock_transfers where request_id=$1',[transferId])).rows[0].total_value),32.5);
await db.query("select create_stock_scrap($1,$2,$3,$4::jsonb,'Valued scrap')",[randomUUID(),center,loc2,JSON.stringify([{product_id:rice.id,quality_id:rice.quality,quantity:1}])]);
assert.equal((await report()).scrapLoss,32.5);assert.equal(await value(),beforeTransfer-32.5);
// Reused lot gets its remaining value, not the old/original or last receipt cost.
await buy(raw,2,50,'EXPENSIVE');
const remainingLot=(await db.query('select * from stock_lot_valuations() where lot_id=$1',[await lot('EXPENSIVE')])).rows[0];assert.equal(Number(remainingLot.inventory_value),220);assert.equal(Number(remainingLot.available_quantity),6);
const fraction=await save({...base,operation_hours:0,inputs:[input(raw,3,await lot('EXPENSIVE'))],outputs:[output(fractional,3)]});assert.equal(Number((await complete(fraction)).total_cost),110);
const fractionOut=(await db.query('select * from manufacturing_order_outputs where order_id=$1',[fraction])).rows[0];assert.equal(Number(fractionOut.line_cost),110);assert.equal(Number(fractionOut.unit_cost),36.666667);
const fval=(await db.query('select inventory_value from stock_movements where id=$1',[fractionOut.stock_movement_id])).rows[0];assert.equal(Number(fval.inventory_value),110);
const beforeFractionSales=(await report()).cogs;await sell(fractional,1,80);await sell(fractional,2,80);assert.equal((await report()).cogs-beforeFractionSales,110);
assert.equal((await db.query('select * from stock_lot_valuations() where product_id=$1',[fractional.id])).rows.length,0);
const invalidShares=await save({...base,inputs:[input(raw,1,await lot('CHEAP'))],outputs:[output(rice,1,60),output(bran,1,30)]});
const beforeShares=[await n('stock_movements'),await n('manufacturing_cost_entries'),await value()];await assert.rejects(()=>complete(invalidShares),/shares must total/);assert.deepEqual([await n('stock_movements'),await n('manufacturing_cost_entries'),await value()],beforeShares);
await assert.rejects(()=>save({...base,operation_expense_id:randomUUID()}),/Invalid production expense/);
// A blended-lot purchase return removes current carrying value; the historic
// supplier credit difference is explicit, rather than leaving value at zero qty.
const blend=await product('BLEND');const blendPurchase=await buy(blend,10,10,'BLEND-LOT');await buy(blend,10,30,'BLEND-LOT');await sell(blend,10,100);
const blendLine=(await db.query('select id from purchase_order_lines where purchase_order_id=$1',[blendPurchase.purchase_id])).rows[0].id;
const blendReturn=(await db.query("select request_bill_return('purchase',$1,'Carrying value return',$2::jsonb) id",[blendPurchase.purchase_id,JSON.stringify([{line_id:blendLine,quantity:10}])])).rows[0].id;
await db.query("select review_bill_return($1,true,'Approved')",[blendReturn]);
assert.equal((await db.query('select * from stock_lot_valuations() where product_id=$1',[blend.id])).rows.length,0);assert.equal((await report()).purchaseCostVariance,-100);
assert.ok(Math.abs((await report()).closingInventory-await value())<0.000001);
const reconciled=await report();assert.equal(reconciled.revenue,1320);assert.equal(reconciled.cogs,347.5);assert.equal(reconciled.grossProfit,972.5);assert.equal(reconciled.operatingExpenses,0);assert.equal(reconciled.netProfit,840);assert.equal(reconciled.closingInventory,375);
// P&L permissions and center scoping are checked inside the database RPC.
await assert.rejects(()=>db.query("select profit_loss_report('2020-01-01','2099-12-31',$1)",[randomUUID()]),/Center access/);
await assert.rejects(()=>db.query('update manufacturing_cost_entries set amount=0 where order_id=$1',[order]),/permission denied|immutable/);
await db.exec('reset role');await assert.rejects(()=>db.query('update manufacturing_order_outputs set line_cost=0 where order_id=$1',[order]),/immutable/);
assert.equal((await db.query('select m.id from stock_movements m join stock_lot_allocations a on a.movement_id=m.id group by m.id having abs(sum(a.inventory_value))<>m.inventory_value')).rows.length,0);
await db.query("select set_config('test.user',$1,false)",[outsider]);await db.exec('set role authenticated');assert.equal((await db.query('select * from manufacturing_cost_entries')).rows.length,0);assert.equal((await report()).revenue,0);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
await db.query("update profiles set permissions=array['dashboard'],role='center_user' where id=$1",[outsider]);await db.query("select set_config('test.user',$1,false)",[outsider]);await db.exec('set role authenticated');
await assert.rejects(()=>report(),/access|permission/i);
await db.close();console.log('PASS actual selected/reused lot cost, labor/fee/packaging absorption once, immutable exact output allocations, draft/completion retry/rollback, partial-sale COGS/returns, unsold inventory, P&L and tenant isolation.');
