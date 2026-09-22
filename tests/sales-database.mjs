// Run with PGLITE_MODULE pointing to @electric-sql/pglite/dist/index.js.
// Uses an isolated in-memory PostgreSQL database, never production.
import {readFile,readdir} from "node:fs/promises";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
await db.exec("create schema auth; create role authenticated; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user',true),'')::uuid $$;");
for(const name of (await readdir(new URL("../supabase/migrations/",import.meta.url))).filter(n=>n.endsWith(".sql")).sort()){
 let sql=await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8");
 // gen_random_uuid is built into modern PostgreSQL; PGlite doesn't ship pgcrypto.
 sql=sql.replace("create extension if not exists pgcrypto;","");
 try{await db.exec(sql);console.log("Migration OK",name);}catch(e){console.error("Migration failed",name,e.message);process.exit(1);}
}
const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),staff=randomUUID(),outsider=randomUUID(),center=randomUUID(),otherCenter=randomUUID(),loc=randomUUID(),otherLoc=randomUUID(),product=randomUUID(),quality=randomUUID(),bank=randomUUID(),account=randomUUID();
await db.query("insert into organizations(id,name) values($1,'Test'),($2,'Other')",[org,otherOrg]);
for(const [id,role,oid] of [[admin,"super_admin",org],[staff,"center_user",org],[outsider,"super_admin",otherOrg]]){
 await db.query("insert into auth.users(id) values($1)",[id]);
 await db.query("insert into profiles(id,organization_id,full_name,role,permissions) values($1,$2,'Tester',$3,array['dashboard','purchases','sales','cash'])",[id,oid,role]);
}
await db.query("insert into centers(id,organization_id,code,name) values($1,$3,'A','Center A'),($2,$3,'B','Center B')",[center,otherCenter,org]);
await db.query("insert into locations(id,center_id,code,name,is_default) values($1,$2,'MAIN','Main',true),($3,$4,'MAIN','Main',true)",[loc,center,otherLoc,otherCenter]);
await db.query("insert into user_center_access(user_id,center_id) values($1,$2)",[staff,center]);
await db.query("insert into products(id,organization_id,code,name) values($1,$2,'P','Pepper')",[product,org]);
await db.query("insert into product_qualities(id,product_id,name,default_price) values($1,$2,'A',50)",[quality,product]);
await db.query("insert into payment_banks(id,organization_id,code,name) values($1,$2,'BANK','Test bank')",[bank,org]);
await db.query("insert into bank_accounts(id,organization_id,bank_id,account_number,branch_name,branch_code) values($1,$2,$3,'123','Main','001')",[account,org,bank]);
await db.query("insert into stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values($1,$2,$3,$4,$5,'purchase_in',100,50,'test',$6,$7)",[org,center,loc,product,quality,randomUUID(),admin]);
async function actor(id){await db.query("select set_config('test.user',$1,false)",[id]);}
async function expectError(fn,fragment){try{await fn();assert.fail("Expected rejection: "+fragment);}catch(e){assert.match(e.message,new RegExp(fragment,"i"));}console.log("PASS rejects",fragment);}
await actor(admin);
await db.query("select set_sales_price($1,$2,100)",[center,quality]);
const customer=(await db.query("select create_sales_customer($1,'Customer','071','Address') id",[center])).rows[0].id;
const line=(qty=1,location=loc)=>({product_id:product,quality_id:quality,location_id:location,quantity:qty,unit_price:100});
const payment=(method,amount,extra={})=>({method,amount,...extra});
async function sale(lines,pays,cust=customer,request=randomUUID(),c=center){
 return (await db.query("select confirm_center_sale($1,$2,$3,'Test',$4::jsonb,$5::jsonb) id",[request,c,cust,JSON.stringify(lines),JSON.stringify(pays)])).rows[0].id;
}
await actor(staff);
const request=randomUUID();
const id=await sale([line(10)],[payment("cash",500),payment("credit",500)],customer,request);
assert.equal(await sale([line(10)],[payment("cash",500),payment("credit",500)],customer,request),id);
assert.equal((await db.query("select count(*)::int n from sales_orders")).rows[0].n,1);
assert.equal(Number((await db.query("select center_cash_balance($1) n",[center])).rows[0].n),500);
assert.equal(Number((await db.query("select quantity from sales_stock($1)",[center])).rows[0].quantity),90);
assert.equal(Number((await db.query("select outstanding_amount from customer_receivables")).rows[0].outstanding_amount),500);
assert.equal((await db.query("select count(*)::int n from sales_payments where method='credit'")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from payments")).rows[0].n,0);
assert.equal(Number((await db.query("select unit_cost from sales_order_lines")).rows[0].unit_cost),50);
console.log("PASS split payment, idempotency, stock cost, cash, credit and purchase isolation");
await expectError(()=>sale([line(50),line(50)],[payment("cash",10000)]),"Insufficient stock");
await expectError(()=>sale([line(1,otherLoc)],[payment("cash",100)]),"Insufficient stock|Invalid location");
await expectError(()=>sale([line()],[payment("credit",100)],null),"Customer required");
await expectError(()=>sale([line()],[payment("cash",90)]),"allocations");
await expectError(()=>sale([line()],[payment("cash",-1),payment("cash",101)]),"positive amount");
await expectError(()=>sale([{...line(),unit_price:0}],[payment("cash",1)]),"price");
await expectError(()=>sale([line()],[payment("bank_transfer",100)]),"bank account");
await expectError(()=>sale([line()],[payment("cheque",100,{bank_account_id:account})]),"Cheque number");
await expectError(()=>sale([line()],[payment("cash",100)],customer,randomUUID(),otherCenter),"access denied");
await expectError(()=>db.query("select set_sales_price($1,$2,200)",[center,quality]),"Admin");
assert.equal((await db.query("select count(*)::int n from sales_orders")).rows[0].n,1);
console.log("PASS failed postings roll back all records");
await sale([line()],[payment("cheque",100,{bank_account_id:account,cheque_number:"C123",cheque_date:"2026-10-01"})]);
await sale([line()],[payment("bank_transfer",50,{bank_account_id:account}),payment("cash",50)]);
const cashBank=(await db.query("select bank_account_id from sales_payments where method='cash'")).rows;
assert.ok(cashBank.every(p=>p.bank_account_id===null));
await db.query("update bank_accounts set is_active=false where id=$1",[account]);
await expectError(()=>sale([line()],[payment("card",100,{bank_account_id:account})]),"active bank account");
await actor(outsider);
await expectError(()=>sale([line()],[payment("cash",100)]),"access denied");
await actor(admin);
await db.query("select set_sales_price($1,$2,100)",[otherCenter,quality]);
await db.query("insert into stock_movements(organization_id,center_id,location_id,product_id,quality_id,movement_type,quantity,unit_cost,reference_type,reference_id,created_by) values($1,$2,$3,$4,$5,'purchase_in',5,50,'test',$6,$7)",[org,otherCenter,otherLoc,product,quality,randomUUID(),admin]);
await sale([line(1,otherLoc)],[payment("cash",100)],null,randomUUID(),otherCenter);
await actor(staff);
await db.exec("grant usage on schema public,auth to authenticated; grant select on all tables in schema public to authenticated; set role authenticated;");
assert.equal((await db.query("select count(*)::int n from sales_orders")).rows[0].n,3);
await expectError(()=>db.query("delete from sales_orders"),"permission denied");
await actor(outsider);
assert.equal((await db.query("select count(*)::int n from sales_orders")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from sales_order_lines")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from customers")).rows[0].n,0);
await db.exec("reset role;");
await actor(staff);await db.query("update profiles set is_active=false where id=$1",[staff]);
await expectError(()=>sale([line()],[payment("cash",100)]),"access denied");
await db.query("update profiles set is_active=true,permissions=array['dashboard'] where id=$1",[staff]);
await expectError(()=>sale([line()],[payment("cash",100)]),"access denied");
console.log("PASS RLS center/tenant isolation, immutable rows, inactive-user and module-permission rejection");
await db.query("update profiles set permissions=array['sales'] where id=$1",[staff]);
await db.query("delete from sales_prices where center_id=$1",[center]);
const customId=await sale([{...line(),unit_price:123.45}],[payment("cash",123.45)]);
assert.equal(Number((await db.query("select unit_price from sales_order_lines where sales_order_id=$1",[customId])).rows[0].unit_price),123.45);
await expectError(()=>sale([{...line(),unit_price:1.234}],[payment("cash",1.23)]),"selling price");
await expectError(()=>sale([{...line(),unit_price:-1}],[payment("cash",1)]),"selling price");
await expectError(()=>sale([{...line(),product_id:randomUUID()}],[payment("cash",100)]),"stock|product");
console.log("PASS seller-entered price without admin price, stored actual rate and invalid-price rejection");
await db.close();console.log("ALL SALES DATABASE TESTS PASSED");
