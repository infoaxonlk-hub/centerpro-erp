process.on("uncaughtException",e=>{console.error(e.stack,e.where??"",e.query??"");process.exit(1)});
// Isolated in-memory migration replay; no remote clients or credentials.
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
const legacyOrg=randomUUID(),legacyActor=randomUUID(),legacyCenter=randomUUID(),legacyCustomer=randomUUID(),legacySupplier=randomUUID(),legacySale=randomUUID(),legacyPurchase=randomUUID();
const newKeys=['registered_name','trading_name','legal_email','business_registration_number','tin','payment_terms_days','payment_terms_note','legal_revision','party_classification'];
async function legacyState(){const result={};for(const table of ['organizations','customers','suppliers','sales_orders','sales_invoices','customer_receivables','purchase_orders','supplier_payables'])result[table]=(await db.query(`select to_jsonb(t)-$1::text[] row from ${table} t order by id`,[newKeys])).rows;return result;}
let beforeMigration;
for (const name of (await readdir(new URL("../supabase/migrations/",import.meta.url)))
  .filter(name=>name.endsWith(".sql")&&!name.includes("verify")).sort()) {
  if(name.startsWith('061_')){
   await db.query("insert into organizations(id,name) values($1,'Existing business')",[legacyOrg]);
   await db.query('insert into auth.users(id) values($1)',[legacyActor]);
   await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,'Legacy','admin')",[legacyActor,legacyOrg]);
   await db.query("insert into centers(id,organization_id,code,name) values($1,$2,'LEG','Legacy')",[legacyCenter,legacyOrg]);
   await db.query("insert into customers(id,organization_id,center_id,name,phone,address,created_by) values($1,$2,$3,'Legacy customer','077','Existing address',$4)",[legacyCustomer,legacyOrg,legacyCenter,legacyActor]);
   await db.query("insert into suppliers(id,organization_id,name,nic_or_registration,bank_details) values($1,$2,'Legacy supplier','Existing NIC','Private bank')",[legacySupplier,legacyOrg]);
   await db.query("insert into sales_orders(id,request_id,organization_id,center_id,customer_id,customer_name,sale_number,total_amount,paid_amount,credit_balance,payment_status,created_by) values($1,$2,$3,$4,$5,'Legacy customer','SO-LEG',100,0,100,'unpaid',$6)",[legacySale,randomUUID(),legacyOrg,legacyCenter,legacyCustomer,legacyActor]);
   await db.query("insert into customer_receivables(organization_id,center_id,customer_id,sales_order_id,original_amount,outstanding_amount) values($1,$2,$3,$4,100,100)",[legacyOrg,legacyCenter,legacyCustomer,legacySale]);
   await db.query("insert into purchase_orders(id,organization_id,center_id,supplier_id,po_number,status,payment_method,total_amount,credit_balance,created_by) values($1,$2,$3,$4,'PO-LEG','confirmed','credit',200,200,$5)",[legacyPurchase,legacyOrg,legacyCenter,legacySupplier,legacyActor]);
   await db.query("insert into supplier_payables(organization_id,center_id,supplier_id,purchase_order_id,original_amount,outstanding_amount,created_by) values($1,$2,$3,$4,200,200,$5)",[legacyOrg,legacyCenter,legacySupplier,legacyPurchase,legacyActor]);
   beforeMigration=await legacyState();
  }
  const sql=(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"))
    .replace("create extension if not exists pgcrypto;","");
  try { await db.exec(sql); } catch(error) { throw new Error("Migration "+name+": "+error.message); }
}
assert.deepEqual(await legacyState(),beforeMigration,'061 retains existing master IDs, original fields, invoice/order references and nonzero customer/supplier balances');
assert.equal((await db.query('select tin,registered_name from customers where id=$1',[legacyCustomer])).rows[0].tin,null);
assert.equal(Number((await db.query('select count(*) count from legal_vat_registrations')).rows[0].count),0,'No historical VAT data fabricated');

const org=randomUUID(),foreignOrg=randomUUID(),admin=randomUUID(),worker=randomUUID(),outsider=randomUUID(),farmAdmin=randomUUID(),limitedAdmin=randomUUID();
const center=randomUUID(),hiddenCenter=randomUUID(),foreignCenter=randomUUID();
await db.query("insert into organizations(id,name) values($1,'Business'),($2,'Foreign')",[org,foreignOrg]);
await db.query("insert into business_module_entitlements(organization_id,module_key,enabled) select o.id,m.key,true from organizations o cross join business_module_catalog m on conflict(organization_id,module_key) do update set enabled=true");
for(const [id,oid,role,permissions] of [[admin,org,'admin',['sales','purchases','masters','users','farm_services','audit']],[worker,org,'center_user',['sales']],[outsider,foreignOrg,'admin',['sales','purchases','users']],[farmAdmin,org,'admin',['farm_services']],[limitedAdmin,org,'admin',['dashboard']]]){
 await db.query('insert into auth.users(id) values($1)',[id]);
 await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Tester',$3,$4)",[id,oid,role,permissions]);
}
await db.query("insert into centers(id,organization_id,code,name) values($1,$2,'C','Center'),($3,$2,'H','Hidden'),($4,$5,'F','Foreign')",[center,org,hiddenCenter,foreignCenter,foreignOrg]);
await db.query('insert into user_center_access(user_id,center_id) values($1,$2)',[worker,center]);
async function actor(id){await db.exec('reset role');await db.query("select set_config('test.user',$1,false)",[id]);await db.exec('set role authenticated');}
async function scalar(sql,args=[]){return (await db.query(sql,args)).rows[0]?.value;}
const payload=(name='Party')=>({name,registered_name:'Registered Ltd',trading_name:'Trade',legal_email:'office@example.test',business_registration_number:'BR-1',tin:'123456789',payment_terms_days:30,payment_terms_note:'Net 30',addresses:[{kind:'billing',is_default:true,line1:'Main street',city:'Colombo',country_code:'LK'},{kind:'delivery',is_default:false,line1:'Z road',country_code:'LK'},{kind:'delivery',is_default:false,line1:'A road',country_code:'LK'}],vat_registrations:[{status:'registered',registration_number:'VAT-1',valid_from:'2026-01-01',valid_to:'2026-07-01'},{status:'not_registered',valid_from:'2026-07-01',valid_to:null}]});
async function read(kind,id){return scalar('select read_legal_master($1,$2) value',[kind,id]);}
async function save(kind,id,data,atCenter=center){return scalar('select save_legal_master($1,$2,$3::jsonb,$4) value',[kind,id,JSON.stringify(data),atCenter]);}
async function snapshot(kind,id,date='2026-06-30'){return scalar('select build_legal_snapshot($1,$2,$3::date) value',[kind,id,date]);}
await actor(admin);
const counts=await db.query('select (select count(*) from stock_movements) stock,(select count(*) from sales_orders) sales,(select count(*) from purchase_orders) purchases,(select count(*) from payments) payments');
const customer=await save('customer',null,payload());
const supplier=await save('supplier',null,payload('Supplier'));
const business=await read('business',org);await save('business',org,{...payload('Business'),legal_revision:business.legal_revision});
const hiddenCustomer=await save('customer',null,payload('Hidden'),hiddenCenter);
const original=await read('customer',customer);assert.equal(original.payment_terms_days,30);assert.equal(original.can_edit,true);
assert.equal(original.tin,'123456789');assert.equal(original.vat_registrations[0].registration_number,'VAT-1');
const frozen=await snapshot('customer',customer);assert.equal(frozen.schema_version,1);assert.equal(frozen.vat.status,'registered');assert.equal(frozen.addresses.billing.line1,'Main street');assert.equal(frozen.addresses.delivery.line1,'A road');assert.equal(frozen.addresses.registered,null);
assert.equal((await snapshot('customer',customer,'2026-07-01')).vat.status,'not_registered');
assert.equal((await snapshot('customer',customer,'2025-12-31')).vat.status,'unknown');
// Store a value exactly as future documents will; master mutation cannot touch it.
await db.exec('reset role');await db.exec('create temporary table frozen_document(snapshot jsonb)');await db.query('insert into frozen_document values($1)',[JSON.stringify(frozen)]);await actor(admin);
await save('customer',customer,{...original,registered_name:'Changed Ltd',addresses:[{kind:'billing',is_default:true,line1:'New street',country_code:'LK'}]});
assert.equal((await snapshot('customer',customer)).party.registered_name,'Changed Ltd');
await db.exec('reset role');assert.deepEqual(await scalar('select snapshot value from frozen_document'),frozen);await actor(admin);
await assert.rejects(save('customer',customer,original),/legal.conflict/);
const latest=await read('customer',customer);
await assert.rejects(save('customer',customer,{...latest,vat_registrations:[{status:'registered',registration_number:'X',valid_from:'2026-01-01',valid_to:null},{status:'unknown',valid_from:'2026-02-01',valid_to:null}]}),/legal.vat_overlap/);
await assert.rejects(save('customer',customer,{...latest,vat_registrations:[{status:'registered',registration_number:'',valid_from:'2026-01-01'}]}),/check constraint/);
await assert.rejects(save('customer',customer,{...latest,vat_registrations:[{status:'unknown',valid_from:'2026-02-01',valid_to:'2026-02-01'}]}),/check constraint/);
await assert.rejects(save('customer',customer,{...latest,legal_email:'bad email'}),/legal.invalid_email/);
await assert.rejects(save('customer',customer,{...latest,payment_terms_days:-1}),/check constraint/);
await assert.rejects(save('customer',customer,{...latest,addresses:[{kind:'billing',is_default:true,line1:'One'},{kind:'billing',is_default:true,line1:'Two'}]}),/unique constraint/);
assert.deepEqual(await read('customer',customer),latest,'invalid complete edits roll back atomically');
await assert.rejects(db.query("insert into legal_addresses(organization_id,customer_id,kind,line1) values($1,$2,'billing','Bypass')",[org,customer]),/permission denied/);
await assert.rejects(db.query("delete from legal_vat_registrations where customer_id=$1",[customer]),/permission denied/);
// Quick masters need none of the legal data; no balance or tax backfill.
const quick=await scalar("select create_sales_customer($1,'Quick',null,null) value",[center]);assert.equal((await snapshot('customer',quick)).vat.status,'unknown');
assert.equal((await read('customer',quick)).registered_name,null);
await actor(worker);assert.equal((await read('customer',customer)).can_edit,false);
await assert.rejects(read('customer',hiddenCustomer),/legal.access_denied/);
await assert.rejects(snapshot('customer',hiddenCustomer),/legal.access_denied/);
assert.equal(Number(await scalar('select count(*) value from legal_addresses where customer_id=$1',[hiddenCustomer])),0);
await assert.rejects(save('customer',customer,latest),/legal.access_denied/);
assert.equal((await db.query("update customers set tin='bypass' where id=$1 returning id",[customer])).rows.length,0,'RLS filters unauthorized direct updates');
await assert.rejects(save('customer',null,payload()),/legal.access_denied/);
await actor(outsider);await assert.rejects(read('customer',customer),/legal.access_denied/);await assert.rejects(read('supplier',supplier),/legal.access_denied/);await assert.rejects(read('business',org),/legal.access_denied/);
assert.equal(Number(await scalar('select count(*) value from legal_addresses')),0);
await actor(limitedAdmin);await assert.rejects(read('customer',customer),/legal.access_denied/);await assert.rejects(read('supplier',supplier),/legal.access_denied/);await assert.rejects(read('business',org),/legal.access_denied/);
// Services-only administrators can maintain their shared customers, not issuer settings.
await actor(farmAdmin);assert.equal((await read('customer',customer)).can_edit,true);await assert.rejects(read('business',org),/legal.access_denied/);
const farmCustomer=await scalar("select create_farm_customer($1,'Farm quick',null,null) value",[center]);assert.equal((await snapshot('customer',farmCustomer)).vat.status,'unknown');
// Explicit typed-FK cross-tenant guard also protects SECURITY DEFINER writes.
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
const foreignCustomer=randomUUID();await db.query("insert into customers(id,organization_id,center_id,name,created_by) values($1,$2,$3,'Foreign',$4)",[foreignCustomer,foreignOrg,foreignCenter,outsider]);
await assert.rejects(db.query("insert into legal_addresses(organization_id,customer_id,kind,line1) values($1,$2,'billing','Mismatch')",[org,foreignCustomer]),/another business/);
await actor(admin);
const audit=await scalar("select jsonb_agg(after_data) value from audit_logs where action in ('legal_master_saved','legal_fields_changed')");assert.ok(audit.length>0);assert.ok(!JSON.stringify(audit).includes('VAT-1'));assert.ok(!JSON.stringify(audit).includes('123456789'));assert.ok(!JSON.stringify(audit).includes('Main street'));
await db.exec('reset role');await db.query("select set_config('test.user','',false)");assert.deepEqual((await db.query('select (select count(*) from stock_movements where organization_id=$1) stock,(select count(*) from sales_orders where organization_id=$1) sales,(select count(*) from purchase_orders where organization_id=$1) purchases,(select count(*) from payments where organization_id=$1) payments',[org])).rows,counts.rows);
await actor(admin);
const beforeUnified=await read('customer',customer);
const unifiedId=await scalar('select save_party_master($1,$2,$3::jsonb,$4) value',['customer',customer,JSON.stringify({...beforeUnified,phone:'0771234',address:'Existing contact address',party_classification:'individual'}),center]);
assert.equal(unifiedId,customer);
const unified=await scalar('select read_party_master($1,$2) value',['customer',customer]);
assert.equal(unified.phone,'0771234');assert.equal(unified.address,'Existing contact address');assert.equal(unified.party_classification,'individual');assert.equal(unified.vat_registrations[0].status,'registered','Individual does not imply a VAT status');
await assert.rejects(scalar('select save_party_master($1,$2,$3::jsonb) value',['customer',customer,JSON.stringify({...unified,party_classification:'vat_registered',phone:'Should roll back'})]),/check constraint/);
assert.equal((await scalar('select read_party_master($1,$2) value',['customer',customer])).phone,'0771234');
const supplierData=await scalar('select read_party_master($1,$2) value',['supplier',supplier]);
await scalar('select save_party_master($1,$2,$3::jsonb) value',['supplier',supplier,JSON.stringify({...supplierData,phone:'0111234',nic_or_registration:'NIC1',notes:'Note',bank_details:'Private bank',party_classification:'company'})]);
assert.equal((await scalar('select read_party_master($1,$2) value',['supplier',supplier])).bank_details,'Private bank');
assert.ok(!JSON.stringify(await snapshot('supplier',supplier)).includes('Private bank'),'private supplier basic data must not enter snapshots');
await actor(worker);await assert.rejects(scalar('select save_party_master($1,$2,$3::jsonb) value',['customer',customer,JSON.stringify(unified)]),/legal.access_denied/);
await assert.rejects(scalar('select read_party_master($1,$2) value',['customer',hiddenCustomer]),/legal.access_denied/);
await actor(outsider);await assert.rejects(scalar('select read_party_master($1,$2) value',['supplier',supplier]),/legal.access_denied/);
await db.exec('reset role');await db.query("select set_config('test.user','',false)");
await db.query("update business_module_entitlements set enabled=false where organization_id=$1 and module_key in ('sales','farm_services')",[org]);await actor(admin);await assert.rejects(read('customer',customer),/legal.access_denied/);
await db.close();console.log('PASS isolated replay through 062; unified basic/legal save, classification, tenant/center/module/edit isolation, VAT boundaries, address defaults, rollback, stale revisions, frozen snapshots and unchanged posting counts.');
