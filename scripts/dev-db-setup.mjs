/**
 * Development-only one-command setup for the legacy CenterPro SQL migrations.
 * Never use this script with a production database.
 * Database schema history is recorded in centerpro_setup.applied_migrations.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenvConfig({ path: path.join(root, ".env.local"), quiet: true });
const migrationDir = path.join(root, "supabase", "migrations");
const adminEmail = "admin@gmail.com";

function fail(message) { throw new Error(message); }
function hash(s) { return createHash("sha256").update(s).digest("hex"); }
function readMigrations() {
  return readdirSync(migrationDir).filter(x => x.endsWith(".sql"))
    .sort((a,b) => a.localeCompare(b,"en",{numeric:false}))
    .map(name => {
      const sql = readFileSync(path.join(migrationDir,name),"utf8");
      return {name,sql,sha256:hash(sql)};
    });
}
function unwrapTransaction(sql,name) {
  const m = [...sql.matchAll(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/gim)];
  if (!m.length) return sql;
  if (m.length!==2 || m[0][1].toUpperCase()!=="BEGIN" ||
      m[1][1].toUpperCase()!=="COMMIT") fail("Unexpected transactions in "+name);
  const before = sql.slice(0,m[0].index);
  const after = sql.slice(m[1].index + m[1][0].length);
  if (before.replace(/--[^\r\n]*/g,"").trim() || after.trim()) {
    fail("Unexpected SQL outside transaction wrapper in "+name);
  }
  return before+"\n"+sql.slice(m[0].index+m[0][0].length,m[1].index)+"\n";
}
function verifyTarget() {
  const ref = process.env.CENTERPRO_DEV_PROJECT_REF?.trim();
  const dbString = process.env.DEV_DATABASE_URL;
  const apiString = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (process.env.CENTERPRO_DB_SETUP_MODE!=="development") {
    fail("Development-only mode required: CENTERPRO_DB_SETUP_MODE=development");
  }
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || !dbString || !apiString) {
    fail("Missing CENTERPRO_DEV_PROJECT_REF, DEV_DATABASE_URL, or NEXT_PUBLIC_SUPABASE_URL");
  }
  const projectConfig=readFileSync(path.join(root,"supabase","config.toml"),"utf8");
  const protectedRef=projectConfig.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (ref===protectedRef) fail("Target is the protected repository project. Refusing.");
  let db,api;
  try { db=new URL(dbString); api=new URL(apiString); }
  catch { fail("Invalid Supabase URL or Postgres connection string."); }
  if (api.protocol!=="https:" || api.hostname!==ref+".supabase.co") {
    fail("NEXT_PUBLIC_SUPABASE_URL does not match expected development project.");
  }
  const direct = db.hostname==="db."+ref+".supabase.co";
  const pooler = db.hostname.endsWith(".pooler.supabase.com") &&
    decodeURIComponent(db.username)==="postgres."+ref;
  if (!["postgres:","postgresql:"].includes(db.protocol) || (!direct && !pooler)) {
    fail("DEV_DATABASE_URL is not the direct/session-pooler URL for the expected Supabase project.");
  }
  if (db.searchParams.get("sslmode")==="disable") fail("Remote database TLS cannot be disabled.");
  return {dbString,apiString};
}
const grantsSql = [
  "GRANT USAGE ON SCHEMA public TO authenticated, service_role;",
  "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;",
  "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;",
  "GRANT EXECUTE ON FUNCTION public.current_profile(), public.is_admin(), public.can_access_center(uuid) TO authenticated;",
  "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;",
  "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;",
  "DO $g$",
  "DECLARE r record; p text;",
  "BEGIN",
  " FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace",
  "          WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity",
  " LOOP",
  "   FOR p IN SELECT DISTINCT x.privilege FROM (",
  "     SELECT 'SELECT' AS privilege, ARRAY['SELECT','ALL'] AS cmds",
  "     UNION ALL SELECT 'INSERT',ARRAY['INSERT','ALL']",
  "     UNION ALL SELECT 'UPDATE',ARRAY['UPDATE','ALL']",
  "     UNION ALL SELECT 'DELETE',ARRAY['DELETE','ALL']",
  "   ) x WHERE EXISTS (",
  "     SELECT 1 FROM pg_policies pol WHERE pol.schemaname=r.nspname",
  "       AND pol.tablename=r.relname AND pol.cmd=ANY(x.cmds)",
  "       AND ('public'=ANY(pol.roles) OR 'authenticated'=ANY(pol.roles))",
  "   )",
  "   LOOP",
  "     EXECUTE format('GRANT %s ON TABLE %I.%I TO authenticated',p,r.nspname,r.relname);",
  "   END LOOP;",
  " END LOOP;",
  "END $g$;"
].join("\n");

async function applyGrants(db) {
  await db.query(grantsSql);
  const q=await db.query([
    "SELECT has_table_privilege('authenticated','public.profiles','SELECT') AS user_profile,",
    "has_table_privilege('service_role','public.profiles','SELECT') AS service_profile,",
    "has_table_privilege('service_role','public.organizations','SELECT') AS service_organization,",
    "(SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass) AS rls_enabled"
  ].join(" "));
  if (!Object.values(q.rows[0]).every(Boolean)) fail("Profile grants/RLS checks failed.");
  console.log("Verified API grants and profile RLS.");
}

async function seedAdmin(db,target) {
  if ((await db.query("SELECT 1 FROM public.profiles WHERE role='super_admin' LIMIT 1")).rowCount) {
    console.log("super_admin already exists; seed SKIPPED without changing any user or password.");
    return;
  }
  const existing=await db.query("SELECT id FROM auth.users WHERE lower(email)=lower($1) LIMIT 1",[adminEmail]);
  if (existing.rowCount) {
    fail("The bootstrap email already exists in Auth without a Super Admin. Review account ownership manually; refusing automatic privilege elevation.");
  }
  let userId=null;
  let createdId=null;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!userId) {
    const password=process.env.DEV_BOOTSTRAP_ADMIN_PASSWORD;
    if (!password || password.length<12 || password==="Admin@123") {
      fail("Set a UNIQUE 12+ character DEV_BOOTSTRAP_ADMIN_PASSWORD. No shared/hardcoded password allowed.");
    }
    if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is missing for initial Auth user creation.");
    const api=createClient(target.apiString,serviceKey,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data,error}=await api.auth.admin.createUser({
      email:adminEmail,password,email_confirm:true,
      user_metadata:{full_name:"Development Administrator"}
    });
    if (error || !data?.user) fail("Auth user creation failed: "+(error?.message||"unknown error"));
    createdId=data.user.id;
    userId=createdId;
  }
  try {
    await db.query("BEGIN");
    if ((await db.query("SELECT 1 FROM public.profiles WHERE role='super_admin' LIMIT 1")).rowCount) {
      fail("Another super_admin was created concurrently; review before retrying.");
    }
    if ((await db.query("SELECT 1 FROM public.profiles WHERE id=$1",[userId])).rowCount) {
      fail("Bootstrap user has an existing profile; refusing to elevate it automatically.");
    }
    const orgs=await db.query("SELECT id FROM public.organizations ORDER BY created_at");
    if (orgs.rowCount>1) fail("Multiple organizations found; cannot choose one automatically.");
    let orgId=orgs.rows[0]?.id;
    if (!orgId) {
      const created=await db.query("INSERT INTO public.organizations(name) VALUES($1) RETURNING id",["CenterPro Development"]);
      orgId=created.rows[0].id;
    }
    await db.query([
      "INSERT INTO public.profiles(id,organization_id,full_name,email,role,is_active)",
      "VALUES($1,$2,$3,$4,'super_admin',true)"
    ].join(" "),[userId,orgId,"Development Administrator",adminEmail]);
    const centers=await db.query("SELECT id FROM public.centers WHERE organization_id=$1 LIMIT 1",[orgId]);
    if (!centers.rowCount) {
      const c=await db.query([
        "INSERT INTO public.centers(organization_id,code,name)",
        "VALUES($1,'MAIN','Main Collection Center') RETURNING id"
      ].join(" "),[orgId]);
      await db.query([
        "INSERT INTO public.locations(center_id,code,name,is_default)",
        "VALUES($1,'MAIN','Main Stock Location',true)"
      ].join(" "),[c.rows[0].id]);
    }
    await db.query("COMMIT");
    console.log("Created first development Super Admin account: "+adminEmail);
  } catch (error) {
    await db.query("ROLLBACK").catch(()=>{});
    if (createdId && serviceKey) {
      const api=createClient(target.apiString,serviceKey,{
        auth:{persistSession:false,autoRefreshToken:false}
      });
      const result=await api.auth.admin.deleteUser(createdId);
      if (result.error) console.error("Orphan new Auth user needs cleanup; ID:",createdId);
    }
    throw error;
  }
}

async function main() {
  const argv=process.argv.slice(2);
  if (argv.includes("--predev") && process.env.CENTERPRO_AUTO_SETUP_DEV_DB!=="true") {
    console.log("DB auto-setup is OFF; enable CENTERPRO_AUTO_SETUP_DEV_DB=true for dev startup.");
    return;
  }
  const files=readMigrations();
  for (const f of files) unwrapTransaction(f.sql,f.name);
  if (argv.includes("--plan")) {
    console.log("Local read-only validation OK. Ordered SQL files: "+files.length);
    console.log("First: "+files[0]?.name+" | Last: "+files.at(-1)?.name);
    console.log("No remote changes performed.");
    return;
  }
  if (!argv.includes("--apply") && !argv.includes("--predev")) fail("Pass --plan or --apply.");
  const target=verifyTarget();
  const db=new pg.Client({connectionString:target.dbString,connectionTimeoutMillis:15000});
  await db.connect();
  try {
    await db.query("SELECT pg_advisory_lock(82910403)");
    const initial=await db.query([
      "SELECT to_regclass('public.organizations') IS NOT NULL AS app_exists,",
      "to_regclass('centerpro_setup.applied_migrations') IS NOT NULL AS history_exists"
    ].join(" "));
    if (initial.rows[0].app_exists && !initial.rows[0].history_exists) {
      fail("Existing database has no bootstrap history. Refusing to replay SQL over a manually migrated DB.");
    }
    await db.query([
      "CREATE SCHEMA IF NOT EXISTS centerpro_setup;",
      "CREATE TABLE IF NOT EXISTS centerpro_setup.applied_migrations(",
      "file_name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());",
      "REVOKE ALL ON SCHEMA centerpro_setup FROM PUBLIC;"
    ].join("\n"));
    const existing=await db.query("SELECT file_name,sha256 FROM centerpro_setup.applied_migrations");
    const history=new Map(existing.rows.map(r=>[r.file_name,r.sha256]));
    const fileNames = new Set(files.map(f => f.name));
    for (const name of history.keys()) {
      if (!fileNames.has(name)) fail("Previously applied migration missing from source: "+name);
    }
    const lastAppliedIndex = files.reduce((last,f,i) => history.has(f.name) ? i : last, -1);
    for (let i=0;i<lastAppliedIndex;i++) {
      if (!history.has(files[i].name)) {
        fail("New migration inserted before already-applied migrations: "+files[i].name+". Add a later-numbered migration instead.");
      }
    }
    let applied=0;
    for (const f of files) {
      if (history.has(f.name)) {
        if (history.get(f.name)!==f.sha256) fail("Applied migration changed: "+f.name);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL lock_timeout='12s'");
        await db.query("SET LOCAL statement_timeout='240s'");
        await db.query(unwrapTransaction(f.sql,f.name));
        await db.query("INSERT INTO centerpro_setup.applied_migrations(file_name,sha256) VALUES($1,$2)",[f.name,f.sha256]);
        await db.query("COMMIT");
        console.log("Applied "+f.name);
        applied++;
      } catch (error) {
        await db.query("ROLLBACK").catch(()=>{});
        fail("Migration "+f.name+" rolled back: "+error.message);
      }
    }
    console.log("Migrations newly applied: "+applied+"; already applied: "+(files.length-applied));
    await applyGrants(db);
    await seedAdmin(db,target);
  } finally {
    await db.query("SELECT pg_advisory_unlock(82910403)").catch(()=>{});
    await db.end().catch(()=>{});
  }
}
main().catch(e=>{console.error("DEV DB SETUP STOPPED:",e.message);process.exitCode=1;});
