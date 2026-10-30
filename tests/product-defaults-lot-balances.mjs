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
  .filter(name=>name.endsWith(".sql")&&!name.includes("verify")&&Number(name.slice(0,3))<51).sort()) {
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
// An existing tracked receipt is deliberately NOT guessed into an available lot.
const historical=await confirm([line(5,9,{mode:'number',number:'HISTORICAL'})]);
await db.exec('reset role');
const beforeCosts=(await db.query('select id,unit_cost from stock_movements order by id')).rows;
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')&&Number(name.slice(0,3))>=51).sort())await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
assert.deepEqual((await db.query('select id,unit_cost from stock_movements order by id')).rows,beforeCosts);
await db.exec('set role authenticated');
const balances=async()=>(await db.query('select * from stock_lot_balances()')).rows;
const qty=async(lotId=null,location=loc)=>Number((await balances()).find(r=>r.lot_id===lotId&&r.location_id===location&&r.product_id===product)?.available_quantity??0);
assert.equal(await qty(),5);
assert.equal((await balances()).filter(r=>r.lot_id!==null).length,0);
assert.equal((await rows('products')).find(p=>p.id===plain).default_sales_price,null);
assert.equal((await rows('products')).find(p=>p.id===plain).costing_method,'AVCO');
const configured=(await db.query("select create_product_with_pricing('CONFIG','Configured',null,'KG',17,false,true,25,'FIFO') id")).rows[0].id;
const configuredQuality=(await db.query('select id from product_qualities where product_id=$1',[configured])).rows[0].id;
assert.equal(Number((await rows('products')).find(p=>p.id===configured).default_sales_price),25);
await db.query("select edit_product_defaults($1,'CONFIG','Changed',null,'KG',false,true,29,'AVCO',$2::jsonb)",[configured,JSON.stringify([{quality_id:configuredQuality,price:19}])]);
assert.equal(Number((await db.query('select default_price from product_qualities where id=$1',[configuredQuality])).rows[0].default_price),19);
assert.equal(Number((await rows('products')).find(p=>p.id===configured).default_sales_price),29);
await assert.rejects(()=>db.query("select edit_product_defaults($1,'CONFIG','Invalid',null,'KG',false,true,29,'AVCO',$2::jsonb)",[configured,JSON.stringify([{quality_id:quality,price:999}])]),/Invalid product quality/);
assert.equal((await rows('products')).find(p=>p.id===configured).name,'Changed');

const first=await confirm([line(10,10,{mode:'number',number:'A'})]);
const a=(await rows('purchase_lots')).find(l=>l.lot_number==='A').id;
// Separate confirmed timestamps make the oldest physical lot deterministic.
await new Promise(resolve=>setTimeout(resolve,5));
const request=randomUUID(),second=await confirm([line(8,12,{mode:'number',number:'B'})],request);
const b=(await rows('purchase_lots')).find(l=>l.lot_number==='B').id;
assert.equal(await qty(a),10);assert.equal(await qty(b),8);assert.equal(await qty(),5);
const allocCount=await count('stock_lot_allocations');
await confirm([line(999,999,{mode:'number',number:'IGNORE-RETRY'})],request);
assert.equal(await count('stock_lot_allocations'),allocCount);
const prices=async()=>(await db.query('select * from latest_purchase_prices()')).rows;
assert.equal(Number((await prices()).find(r=>r.quality_id===quality).price),12);
// Editing a default never touches valuation or historical receipts.
const snapshot=(await db.query('select id,unit_cost from stock_movements order by id')).rows;
await db.query("select edit_product_defaults($1,'LOT','Tracked',null,'KG',false,true,21,'FIFO',$2::jsonb)",[product,JSON.stringify([{quality_id:quality,price:99}])]);
assert.deepEqual((await db.query('select id,unit_cost from stock_movements order by id')).rows,snapshot);
assert.equal(Number((await prices()).find(r=>r.quality_id===quality).price),12);
assert.equal(Number((await rows('purchase_lot_receipts')).find(r=>r.purchase_id===first.purchase_id).unit_purchase_price),10);

const saleLine=(quantity)=>({product_id:product,quality_id:quality,location_id:loc,quantity,unit_price:20});
const saleRequest=randomUUID();
const saleArgs=[saleRequest,center,JSON.stringify([saleLine(7)]),JSON.stringify([{method:'cash',amount:140}])];
const sale=(await db.query("select confirm_center_sale($1,$2,null,'Lots',$3::jsonb,$4::jsonb) id",saleArgs)).rows[0].id;
assert.equal(await qty(),0);assert.equal(await qty(a),8);assert.equal(await qty(b),8);
const afterSale=await count('stock_lot_allocations');
await db.query("select confirm_center_sale($1,$2,null,'Retry',$3::jsonb,$4::jsonb)",saleArgs);
assert.equal(await count('stock_lot_allocations'),afterSale);
const source=(await db.query('select id from sales_order_lines where sales_order_id=$1',[sale])).rows[0].id;
const returned=(await db.query("select request_bill_return('sale',$1,'Return original allocation',$2::jsonb) id",[sale,JSON.stringify([{line_id:source,quantity:6}])])).rows[0].id;
await db.query("select review_bill_return($1,true,'Approved')",[returned]);
assert.equal(await qty(),5);assert.equal(await qty(a),9);
await assert.rejects(()=>db.query("select review_bill_return($1,true,'Retry')",[returned]),/Pending return/);

const transfer=randomUUID(),transferArgs=[transfer,center,loc,loc2,JSON.stringify([{product_id:product,quality_id:quality,quantity:7}])];
await db.query("select create_stock_transfer($1,$2,$3,$2,$4,$5::jsonb,'Lots')",transferArgs);
assert.equal(await qty(),0);assert.equal(await qty(a),7);assert.equal(await qty(null,loc2),5);assert.equal(await qty(a,loc2),2);
const afterTransfer=await count('stock_lot_allocations');
await db.query("select create_stock_transfer($1,$2,$3,$2,$4,$5::jsonb,'Retry')",transferArgs);
assert.equal(await count('stock_lot_allocations'),afterTransfer);
const scrapArgs=[randomUUID(),center,loc,JSON.stringify([{product_id:product,quality_id:quality,quantity:2}])];
await db.query("select create_stock_scrap($1,$2,$3,$4::jsonb,'Damage')",scrapArgs);
assert.equal(await qty(a),5);
const afterScrap=await count('stock_lot_allocations');
await db.query("select create_stock_scrap($1,$2,$3,$4::jsonb,'Retry')",scrapArgs);assert.equal(await count('stock_lot_allocations'),afterScrap);
// 13 on hand -> 15: additions stay unassigned; reduce to 12 consumes legacy first.
await db.query("select create_stock_adjustment($1,$2,$3,$4,$5,15,10,'Count more')",[randomUUID(),center,loc,product,quality]);
assert.equal(await qty(),2);
await db.query("select create_stock_adjustment($1,$2,$3,$4,$5,12,null,'Count less')",[randomUUID(),center,loc,product,quality]);
assert.equal(await qty(),0);assert.equal(await qty(a),4);assert.equal(await qty(b),8);

// Return the specific B receipt, not whichever A lot is oldest.
const purchaseSource=(await rows('purchase_order_lines')).find(l=>l.purchase_order_id===second.purchase_id).id;
const purchaseReturn=(await db.query("select request_bill_return('purchase',$1,'Return B',$2::jsonb) id",[second.purchase_id,JSON.stringify([{line_id:purchaseSource,quantity:2}])])).rows[0].id;
await db.query("select review_bill_return($1,true,'Approved')",[purchaseReturn]);
assert.equal(await qty(a),4);assert.equal(await qty(b),6);
// Cancellation restores the allocations actually used by the sale.
const cancelledSale=(await db.query("select confirm_center_sale($1,$2,null,'Cancel',$3::jsonb,$4::jsonb) id",[randomUUID(),center,JSON.stringify([saleLine(5)]),JSON.stringify([{method:'cash',amount:100}])])).rows[0].id;
assert.equal(await qty(a),0);assert.equal(await qty(b),5);
const cancellation=(await db.query("select request_bill_cancellation('sale',$1,'Undo') id",[cancelledSale])).rows[0].id;
await db.query("select review_bill_cancellation($1,true,'Approved')",[cancellation]);
assert.equal(await qty(a),4);assert.equal(await qty(b),6);
const cancelledPurchase=await confirm([line(2,90,{mode:'number',number:'CANCEL'})]);
const cancelledLot=(await rows('purchase_lots')).find(l=>l.lot_number==='CANCEL').id;
const purchaseCancellation=(await db.query("select request_bill_cancellation('purchase',$1,'Undo') id",[cancelledPurchase.purchase_id])).rows[0].id;
await db.query("select review_bill_cancellation($1,true,'Approved')",[purchaseCancellation]);
assert.equal(await qty(cancelledLot),0);
assert.equal(Number((await prices()).find(r=>r.quality_id===quality).price),12);
const beforeFailure=await count('stock_lot_allocations');
await assert.rejects(()=>confirm([line(1,10,{mode:'existing',lot_id:randomUUID()})]),/does not belong/);
assert.equal(await count('stock_lot_allocations'),beforeFailure);
assert.equal(Number((await prices()).find(r=>r.quality_id===quality).price),12);
// Equal transaction timestamps have a stable purchase ID then entry-order tie-break.
await db.exec('reset role');
await db.query("update purchase_orders set confirmed_at='2026-01-01T00:00:00Z' where id in ($1,$2,$3)",[historical.purchase_id,first.purchase_id,second.purchase_id]);
await db.query("insert into purchase_orders(organization_id,center_id,supplier_id,po_number,status,payment_method,created_by) values($1,$2,$3,'DRAFT-PRICE','draft','credit',$4)",[org,center,supplier,admin]);
const draftPurchase=(await db.query("select id from purchase_orders where po_number='DRAFT-PRICE'")).rows[0].id;
await db.query('insert into purchase_order_lines(purchase_order_id,product_id,quality_id,location_id,quantity,system_price,actual_price) values($1,$2,$3,$4,1,999,999)',[draftPurchase,product,quality,loc]);
await db.exec('set role authenticated');
const tieExpected=[{id:historical.purchase_id,price:9},{id:first.purchase_id,price:10},{id:second.purchase_id,price:12}].sort((a,b)=>b.id.localeCompare(a.id))[0];
assert.equal(Number((await prices()).find(r=>r.quality_id===quality).price),tieExpected.price);
await assert.rejects(()=>confirm([line(1,31,{mode:'existing',lot_id:a}),line(1,32,{mode:'existing',lot_id:b})]),/one quality and one lot/i);
const splitPrices=await confirm([line(1,31,{mode:'existing',lot_id:b}),line(1,32,{mode:'existing',lot_id:b})]);
assert.equal((await prices()).find(r=>r.quality_id===quality).purchase_id,splitPrices.purchase_id);
assert.equal(Number((await prices()).find(r=>r.quality_id===quality).price),32);
// Identical-price receipts in separate purchases retain exact lot identity on return.
const equalRows=['EXACT-A','EXACT-B'].map(number=>({product_id:configured,quality_id:configuredQuality,location_id:loc,quantity:1,actual_price:19,lot_selection:{mode:'number',number}}));
await confirm([equalRows[0]]);
const equalPurchase=await confirm([equalRows[1]]);
const exactReceipts=(await rows('purchase_lot_receipts')).filter(r=>r.purchase_id===equalPurchase.purchase_id);
const exactB=(await rows('purchase_lots')).find(l=>l.lot_number==='EXACT-B').id;
const exactReturn=(await db.query("select request_bill_return('purchase',$1,'Return exact B',$2::jsonb) id",[equalPurchase.purchase_id,JSON.stringify([{line_id:exactReceipts.find(r=>r.lot_id===exactB).purchase_line_id,quantity:1}])])).rows[0].id;
await db.query("select review_bill_return($1,true,'Approved')",[exactReturn]);
const exactBalances=(await balances()).filter(r=>r.product_id===configured);
assert.equal(exactBalances.length,1);assert.equal(Number(exactBalances[0].available_quantity),1);assert.notEqual(exactBalances[0].lot_id,exactB);
// Every movement reconciles, including all legacy entries and transfers.
await db.exec('reset role');
assert.equal((await db.query("select m.id from stock_movements m left join stock_lot_allocations a on a.movement_id=m.id group by m.id having coalesce(sum(a.quantity),0)<>case when m.movement_type in ('purchase_in','transfer_in','adjustment_in') then m.quantity else -m.quantity end")).rows.length,0);
await db.query("select set_config('test.user',$1,false)",[outsider]);await db.exec('set role authenticated');
assert.equal((await balances()).length,0);assert.equal((await prices()).length,0);
await assert.rejects(()=>db.query("select edit_product_defaults($1,'LOT','Attack',null,'KG',false,true,1,'AVCO','[]')",[product]),/Product not found/);
await assert.rejects(()=>db.exec("insert into stock_lot_allocations(movement_id,quantity) values(gen_random_uuid(),1)"),/permission denied/);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
const staff=randomUUID();await db.query('insert into auth.users(id) values($1)',[staff]);
await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'No access','center_user',array['dashboard'])",[staff,org]);
await db.query("select set_config('test.user',$1,false)",[staff]);await db.exec('set role authenticated');
await assert.rejects(()=>balances(),/Module access restricted|Stock access required/);await assert.rejects(()=>prices(),/Module access restricted|Purchase access required/);
await assert.rejects(()=>db.query("select edit_product_defaults($1,'LOT','Attack',null,'KG',false,true,1,'AVCO','[]')",[product]),/Module access restricted|editing access required/);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key in ('inventory','purchases')",[org]);await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
await assert.rejects(()=>balances(),/Module access restricted/);await assert.rejects(()=>prices(),/Module access restricted/);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");await db.query('update business_module_entitlements set enabled=true where organization_id=$1',[org]);
await db.query("update organizations set business_status='suspended' where id=$1",[org]);await db.query("select set_config('test.user',$1,false)",[admin]);await db.exec('set role authenticated');
await assert.rejects(()=>balances(),/Business access restricted/);await assert.rejects(()=>prices(),/Business access restricted/);
console.log('PASS product price create/edit, future costing, immutable valuation, latest confirmed prices, legacy baseline, oldest allocation, line-specific returns, cancellation, transfer, scrap, adjustment, retries, rollback, tenant/module/subscription guards.');
await db.close();
