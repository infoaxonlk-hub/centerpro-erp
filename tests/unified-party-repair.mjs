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
  .filter(name=>name.endsWith(".sql")&&!name.includes("verify")&&!/^06[23]_/.test(name)).sort()) {
  const sql=(await readFile(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"))
    .replace("create extension if not exists pgcrypto;","");
  try { await db.exec(sql); } catch(error) { throw new Error("Migration "+name+": "+error.message); }
}

const repair=await readFile(new URL('../supabase/migrations/063_unified_party_master_repair.sql',import.meta.url),'utf8');
const org=randomUUID(),user=randomUUID(),center=randomUUID(),customer=randomUUID(),supplier=randomUUID();
await db.query("insert into organizations(id,name) values($1,'Existing')",[org]);
await db.query('insert into auth.users(id) values($1)',[user]);
await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,'Admin','admin')",[user,org]);
await db.query("insert into centers(id,organization_id,code,name) values($1,$2,'C','Center')",[center,org]);
// Reproduce the reported partial schema: customer column exists; supplier does not.
await db.exec('alter table customers add column party_classification text');
await db.query("insert into customers(id,organization_id,center_id,name,created_by,party_classification) values($1,$2,$3,'Customer',$4,'individual')",[customer,org,center,user]);
await db.query("insert into suppliers(id,organization_id,name) values($1,$2,'Supplier')",[supplier,org]);
const before=(await db.query('select to_jsonb(c) row from customers c where id=$1',[customer])).rows;
await db.exec(repair);
assert.deepEqual((await db.query('select to_jsonb(c) row from customers c where id=$1',[customer])).rows,before);
assert.equal((await db.query('select party_classification from suppliers where id=$1',[supplier])).rows[0].party_classification,null);
await db.exec(repair); // Complete-installation rerun must not duplicate triggers/functions.
assert.deepEqual((await db.query('select to_jsonb(c) row from customers c where id=$1',[customer])).rows,before);
assert.equal(Number((await db.query("select count(*) n from pg_trigger where tgname='party_classification_guard' and not tgisinternal")).rows[0].n),2);
assert.equal(Number((await db.query("select count(*) n from pg_proc where pronamespace='public'::regnamespace and proname in ('read_party_master','save_party_master')")).rows[0].n),2);
// Incompatible pre-existing data is reported rather than silently rewritten.
await db.exec('alter table customers drop constraint customers_party_classification_values_check');
await db.query("update customers set party_classification='legacy-other' where id=$1",[customer]).catch(async()=>{
 // The installed guard correctly requires an actor for classification changes;
 // use a fixture-only trigger suspension to construct an incompatible database.
 await db.exec('alter table customers disable trigger party_classification_guard');
 await db.query("update customers set party_classification='legacy-other' where id=$1",[customer]);
 await db.exec('alter table customers enable trigger party_classification_guard');
});
await assert.rejects(db.exec(repair),/unsupported classification values/);await db.exec('rollback');
assert.equal((await db.query('select party_classification from customers where id=$1',[customer])).rows[0].party_classification,'legacy-other');
await db.close();console.log('PASS repair 063: existing customer column, missing supplier column, preserved data, repeat installation, no duplicate triggers/RPCs, incompatible values rejected without mutation.');
