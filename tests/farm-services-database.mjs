process.on("uncaughtException",e=>{console.error(e.message,e.where??"",e.query??"");process.exit(1)});
// Isolated PostgreSQL regression: business entitlements and admin permissions stay
// separate until a platform operator explicitly grants the selected admin access.
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {execFileSync} from "node:child_process";

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
  if(name.startsWith('058')&&process.env.FARM_TEST_MAIN_BASELINE==='1'&&!(await readdir(new URL('../supabase/migrations/',import.meta.url))).some(n=>n.startsWith('056'))){for(const filename of ['056_production_valuation_and_profit_loss.sql','057_manufacturing_boms_and_planned_orders.sql'])await db.exec(execFileSync('git',['show','origin/main:supabase/migrations/'+filename],{encoding:'utf8'}));}
  const sql=(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"))
    .replace("create extension if not exists pgcrypto;","");
  try { await db.exec(sql); } catch(error) { throw new Error("Migration "+name+": "+error.message); }
}



const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),worker=randomUUID(),stranger=randomUUID(),center=randomUUID(),otherCenter=randomUUID(),loc=randomUUID(),bank=randomUUID(),account=randomUUID();
await db.query("insert into organizations(id,name) values($1,'Farm'),($2,'Other')",[org,otherOrg]);
await db.query("insert into business_subscriptions(organization_id) values($1),($2) on conflict do nothing",[org,otherOrg]);
await db.query("insert into business_module_entitlements(organization_id,module_key,enabled) select o.id,m.key,true from organizations o cross join business_module_catalog m on conflict(organization_id,module_key) do update set enabled=true");
for(const [id,oid,role,permissions] of [[admin,org,'admin',['farm_services','farm_services_manage','sales','purchases','stock','masters','product_create','product_edit','cash','centers']],[worker,org,'center_user',['farm_services']],[stranger,otherOrg,'admin',['farm_services','farm_services_manage']]]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Tester',$3,$4)",[id,oid,role,permissions]);}
await db.query("insert into centers(id,organization_id,code,name) values($1,$2,'C','Center'),($3,$4,'O','Other')",[center,org,otherCenter,otherOrg]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true)",[loc,center]);
await db.query('insert into user_center_access(user_id,center_id) values($1,$2)',[worker,center]);
await db.query("insert into payment_banks(id,organization_id,code,name) values($1,$2,'TEST','Bank')",[bank,org]);
await db.query("insert into bank_accounts(id,organization_id,bank_id,account_number,branch_name,branch_code) values($1,$2,$3,'123','Main','1')",[account,org,bank]);
async function actor(id){await db.exec('reset role');await db.query("select set_config('test.user',$1,false)",[id]);await db.exec('set role authenticated');}
async function scalar(sql,args=[]){return (await db.query(sql,args)).rows[0]?.value;}
await actor(admin);
const season=await scalar("select save_farm_season(null,'Maha 2026/27',true,true) value");
const service=await scalar("select save_farm_service(null,'PLOUGH','Ploughing','Acre',12000,true) value");
const hour=await scalar("select save_farm_service(null,'HIRE','Tractor hire','Hour',3500,true) value");
const customer=await scalar("select create_farm_customer($1,'Farmer','0771234567','Village') value",[center]);
const base={customer_id:customer,season_id:season,service_id:service,quantity:'2.5',rate:'12000',payment:'credit',initial_paid:'0',adjustments:[]};
async function sale(data=base,request=randomUUID(),c=center){return scalar('select confirm_farm_sale($1,$2,$3::jsonb) value',[request,c,JSON.stringify(data)]);}
const request=randomUUID(),first=await sale(base,request);assert.equal(await sale({...base,quantity:'99'},request),first);
assert.equal(Number(await scalar('select total_amount value from sales_orders where id=$1',[first])),30000);
const second=await sale({...base,service_id:hour,quantity:'1.125',rate:'3500',adjustments:[{kind:'charge',description:'Travel',amount:100},{kind:'deduction',description:'Discount',amount:37.5}],initial_paid:'1000',initial_method:'cash'});
assert.equal(Number(await scalar('select total_amount value from sales_orders where id=$1',[second])),4000);
assert.equal(Number(await scalar('select sum(outstanding_amount) value from customer_receivables where customer_id=$1',[customer])),33000);
assert.equal(Number(await scalar('select count(*) value from sales_payments where sales_order_id=$1',[first])),0);
assert.equal(Number(await scalar("select count(*) value from stock_movements where reference_id in ($1,$2)",[first,second])),0);
const invoice=await scalar('select id value from sales_invoices where sales_order_id=$1',[first]);
const collection=randomUUID();await db.query("select collect_farm_invoice($1,$2,5000,'cash',null,null)",[collection,invoice]);await db.query("select collect_farm_invoice($1,$2,5000,'cash',null,null)",[collection,invoice]);
assert.equal(Number(await scalar('select outstanding_amount value from sales_invoices where id=$1',[invoice])),25000);
await assert.rejects(db.query("select collect_farm_invoice($1,$2,25001,'cash',null,null)",[randomUUID(),invoice]),/exceed|due balance/i);
await assert.rejects(sale({...base,quantity:'NaN'}),/finite/);await assert.rejects(sale({...base,rate:'-1'}),/finite/);await assert.rejects(sale({...base,quantity:'0'}),/Invalid/);
await assert.rejects(sale({...base,adjustments:[{kind:'deduction',description:'Bad',amount:40000}]}),/positive/);
await assert.rejects(sale({...base,initial_paid:'30001',initial_method:'cash'}),/exceed/);
await assert.rejects(sale({...base,initial_paid:'100',initial_method:'credit'}),/Cash or Bank/);
const stockProduct=await scalar("select create_product_with_pricing('RICE','Rice',null,'KG',10,false,false) value");
const stockQuality=await scalar('select id value from product_qualities where product_id=$1',[stockProduct]);
await db.exec('reset role');await db.query("insert into stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values($1,$2,$3,$4,$5,'adjustment_in',20,10,'opening_stock',$6,$7)",[org,center,loc,stockProduct,stockQuality,randomUUID(),admin]);await actor(admin);
const normal=await scalar('select confirm_center_sale($1,$2,$3,null,$4::jsonb,$5::jsonb) value',[randomUUID(),center,customer,JSON.stringify([{product_id:stockProduct,quality_id:stockQuality,location_id:loc,quantity:2,unit_price:100}]),JSON.stringify([{method:'credit',amount:200}])]);
assert.equal(Number(await scalar('select sum(outstanding_amount) value from customer_receivables where customer_id=$1',[customer])),28200);
await db.exec('reset role');assert.equal(Number(await scalar("select sum(case when movement_type='adjustment_in' then quantity else -quantity end) value from stock_movements where product_id=$1",[stockProduct])),18);
const serviceQuality=await scalar('select id value from product_qualities where product_id=$1',[service]);
await assert.rejects(db.query("insert into stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values($1,$2,$3,$4,$5,'adjustment_in',1,0,'opening_stock',$6,$7)",[org,center,loc,service,serviceQuality,randomUUID(),admin]),/Service items/);await actor(admin);
const bankRequest=randomUUID(),bankSale=await sale({...base,payment:'bank_transfer',bank_account_id:account},bankRequest);await sale({...base,payment:'bank_transfer',bank_account_id:account},bankRequest);
const partialBank=await sale({...base,initial_paid:'500',initial_method:'bank_transfer',bank_account_id:account});
const partialInvoice=await scalar('select id value from sales_invoices where sales_order_id=$1',[partialBank]);
const bankCollection=randomUUID();await db.query("select collect_farm_invoice($1,$2,200,'bank_transfer',$3,null)",[bankCollection,partialInvoice,account]);await db.query("select collect_farm_invoice($1,$2,200,'bank_transfer',$3,null)",[bankCollection,partialInvoice,account]);
assert.equal(Number(await scalar('select outstanding_amount value from sales_invoices where id=$1',[partialInvoice])),29300);
// Shared bank/cash ledgers are finance-only tables, inspect through the fixture owner.
await db.exec('reset role');assert.equal(Number(await scalar("select count(*) value from bank_book_entries b join sales_payments p on b.source_id=p.id where b.source_table='sales_payments' and p.sales_order_id=$1",[bankSale])),1);
assert.equal(Number(await scalar("select count(*) value from bank_book_entries b join sales_payments p on b.source_id=p.id where b.source_table='sales_payments' and p.sales_order_id=$1",[partialBank])),2);
assert.equal(Number(await scalar("select sum(amount) value from cash_ledger where reference_id=$1",[second])),1000);
assert.equal(Number(await scalar("select count(*) value from stock_sack_movements where reference_id in ($1,$2)",[first,second])),0);
await actor(worker);
assert.equal(Number(await scalar('select count(*) value from sales_orders where id=$1',[normal])),0);
assert.equal(Number(await scalar('select count(*) value from customers where id=$1',[customer])),1);
assert.equal(Number(await scalar('select count(*) value from sales_orders where id=$1',[first])),1);
await assert.rejects(db.query("select save_farm_service(null,'NO','No','Acre',1,true)"),/management/);
await sale();await assert.rejects(sale(base,randomUUID(),otherCenter),/access/);
await actor(stranger);await assert.rejects(sale(),/access/);
const foreignService=await scalar("select save_farm_service(null,'FOREIGN','Other','Acre',1,true) value"),foreignSeason=await scalar("select save_farm_season(null,'Other season',true,false) value");
await actor(admin);await assert.rejects(sale({...base,service_id:foreignService}),/active service/);await assert.rejects(sale({...base,season_id:foreignSeason}),/active season/);
await actor(admin);const cancelSale=await sale();const cancelRequest=await scalar("select request_bill_cancellation('sale',$1,'Wrong bill') value",[cancelSale]);await db.query("select review_farm_cancellation($1,true,null)",[cancelRequest]);assert.equal(await scalar('select status value from sales_orders where id=$1',[cancelSale]),'cancelled');
const cashCancel=await sale({...base,payment:'cash'}),cashRequest=await scalar("select request_bill_cancellation('sale',$1,'Refund cash bill') value",[cashCancel]);await db.query("select review_farm_cancellation($1,true,null)",[cashRequest]);
await assert.rejects(db.query("select request_bill_cancellation('sale',$1,'Bank needs review')",[bankSale]).then(async r=>db.query("select review_farm_cancellation($1,true,null)",[r.rows[0].request_bill_cancellation])),/manual refund/);
await db.exec('reset role');assert.equal(Number(await scalar("select sum(case when movement_type='sale_receipt' then amount else -amount end) value from cash_ledger where reference_id in ($1,$2)",[cashCancel,cashRequest])),0);
assert.equal(Number(await scalar('select count(*) value from stock_movements where reference_id=$1',[cancelRequest])),0);
await db.query("select set_config('test.user','',false)");await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key='farm_services'",[org]);await actor(worker);await assert.rejects(sale(),/module|access|locked/i);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");await db.query("update business_module_entitlements set enabled=true where organization_id=$1 and module_key='farm_services'",[org]);
await db.query("select set_config('test.user','',false)");await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key in ('sales','customer_receivables')",[org]);await actor(worker);await scalar("select create_farm_customer($1,'Farm only customer',null,null) value",[center]);await sale();await db.query("select collect_farm_invoice($1,$2,100,'cash',null,null)",[randomUUID(),invoice]);
assert.equal(Number(await scalar('select count(*) value from sales_invoices where customer_id=$1',[customer]))>0,true);
await actor(admin);await db.query("select save_farm_service($1,'PLOUGH','New label','Hour',9000,true)",[service]);
assert.equal(await scalar('select unit value from sales_order_lines where sales_order_id=$1',[first]),'Acre');assert.equal(await scalar('select product_name value from sales_order_lines where sales_order_id=$1',[first]),'Ploughing');assert.equal(Number(await scalar('select unit_price value from sales_order_lines where sales_order_id=$1',[first])),12000);
await db.query("select save_farm_season($1,'Archived Maha',false,false)",[season]);assert.equal(await scalar('select season_name value from sales_orders where id=$1',[first]),'Maha 2026/27');await assert.rejects(sale(),/active season/);assert.equal(await sale(base,request),first);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");await db.query("update organizations set business_status='suspended' where id=$1",[org]);await actor(worker);await assert.rejects(sale(),/suspended|operational|subscription|access/i);
if(process.env.FARM_TEST_MAIN_BASELINE==='1'){await db.exec('reset role');assert.equal(Number(await scalar('select coalesce(sum(cogs_value),0) value from sales_order_lines where sales_order_id in ($1,$2)',[first,second])),0);}
await db.close();console.log('PASS Farm Services PostgreSQL: shared invoices/receivables, decimal totals, adjustments, initial/later payments, bank/cash once, credit no cash, no inventory, retry, cancellation, tenant/module/role boundaries and farm-only operation.');
