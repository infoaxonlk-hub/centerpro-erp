import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { catalog, hash, canonical, identity, plan, target, transactional, approval, apply, baseline, verify, exclusive, root } from '../scripts/release-migrations.mjs';

const files = [1, 2, 3].map(n => ({ file_name: `00${n}_test.sql`, sha256: hash(`select ${n};`), kind: 'migration', sql: `select ${n};` }));
const rows = count => files.slice(0, count).map((f, i) => ({ ...identity(f), ordinal: i + 1, origin: 'executed' }));
const ref = 'abcdefghijklmnopqrst';
const env = { CENTERPRO_RELEASE_PROJECT_REF: ref, CENTERPRO_RELEASE_DATABASE_URL: `postgres://postgres@db.${ref}.supabase.co:5432/postgres`, CENTERPRO_RELEASE_WRITE: 'approved-production-release' };
function document() {
  return { version: 1, project_ref: ref, commit: 'a'.repeat(40), manifest_sha256: hash(JSON.stringify(files.map(identity))), approved_by: 'reviewer', evidence_ref: 'ticket-1', backup_ref: 'backup-1', restore_test_ref: 'restore-1', recovery_plan_ref: 'recovery-1', deployment_gate_ref: 'gate-1', backup_verified_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), through: files[2].file_name, pending: files.slice(1).map(identity) };
}

// A transaction-aware transport fixture: failed transactions discard ledger writes.
class Database {
  constructor(initial = rows(1)) { this.rows = structuredClone(initial); this.calls = []; this.present = true; }
  async query(sql, params) {
    this.calls.push(sql);
    if (sql.startsWith('BEGIN')) this.before = structuredClone(this.rows);
    if (sql === 'ROLLBACK') this.rows = this.before;
    if (sql.includes('to_regclass')) return { rows: [{ present: this.present }] };
    if (sql.includes('to_regnamespace')) return { rows: [{ present: this.schemaExists || false }] };
    if (sql.startsWith('SELECT ordinal')) return { rows: structuredClone(this.rows) };
    if (sql === this.failSQL) throw new Error('simulated database failure');
    if (sql.startsWith('INSERT')) {
      if (this.failInsert) throw new Error('simulated ledger insert failure');
      const [ordinal, file_name, sha256, kind, origin] = params;
      assert(!this.rows.some(r => r.file_name === file_name));
      this.rows.push({ ordinal, file_name, sha256, kind, origin });
    }
    return { rows: [] };
  }
}

test('repository manifest covers every SQL including legacy duplicate prefixes', () => {
  const all = catalog();
  assert(all.some(f => f.file_name.startsWith('008a')));
  assert.equal(all.filter(f => f.file_name.startsWith('043')).length, 2);
  assert.equal(all.find(f => f.file_name.includes('verify')).kind, 'verification');
  assert.equal(all.at(-1).file_name, '068_water_treatment_rls_access_fix.sql');
  assert.equal(hash(canonical('a\r\nb')), hash('a\nb'));
  assert.equal(hash('a\r\nb'), hash('a\nb')); // Shared dev/release checksum helper normalizes CRLF.
});

test('Water Treatment module is registered under Inventory and starts disabled', () => {
  const migration = catalog().find(f => f.file_name === '066_water_treatment_module.sql').sql;
  const modules = readFileSync(path.join(root, 'lib/business-modules.ts'), 'utf8');
  const access = readFileSync(path.join(root, 'lib/access.ts'), 'utf8');
  const navigation = readFileSync(path.join(root, 'components/sidebar-navigation.tsx'), 'utf8');
  assert.ok(modules.includes('key: "water_treatment", name: "Water Treatment", href: "/dashboard/water-treatment", permissions: ["water_treatment"], parent: "inventory"'));
  assert.ok(migration.includes("values('water_treatment','Water Treatment','inventory',false)"));
  assert.ok(migration.includes("select id,'water_treatment',false from public.organizations\non conflict(organization_id,module_key) do nothing"));
  assert.ok(migration.includes("key<>''water_treatment''"));
  assert.ok(migration.includes("when ''water_treatment'' then ''water_treatment''=any(p.permissions)"));
  assert.ok(migration.includes("when ''water_treatment'' then array[''water_treatment'']"));
  assert.ok(access.includes('"water_treatment"') && access.includes('water_treatment:"water_treatment"'));
  assert.ok(navigation.includes('label: "Water Treatment", permission: "water_treatment", hideWhenDisabled: true'));
  assert.ok(navigation.includes('return !item.hideWhenDisabled'));
});

test('Water Treatment plant foundation enforces tenant, customer-center, module and append-only history rules', () => {
  const migration = catalog().find(f => f.file_name === '067_water_treatment_plants.sql').sql;
  assert.match(migration, /create table public\.water_treatment_plants/);
  assert.match(migration, /create table public\.water_treatment_plant_history/);
  assert.match(migration, /foreign key \(customer_id, organization_id, center_id\)[\s\S]*references public\.customers\(id, organization_id, center_id\)/);
  assert.match(migration, /unique \(organization_id, plant_code\)/);
  assert.match(migration, /create function public\.assign_water_treatment_plant_code/);
  assert.match(migration, /create function public\.protect_water_treatment_plant_audit_fields/);
  assert.match(migration, /new\.id is distinct from old\.id[\s\S]*new\.organization_id is distinct from old\.organization_id[\s\S]*new\.plant_code is distinct from old\.plant_code[\s\S]*new\.created_by is distinct from old\.created_by[\s\S]*new\.created_at is distinct from old\.created_at/);
  assert.match(migration, /before update on public\.water_treatment_plants[\s\S]*execute function public\.protect_water_treatment_plant_audit_fields\(\)/);
  assert.match(migration, /create function public\.set_water_treatment_plant_updated_at[\s\S]*new\.updated_at:=now\(\)/);
  assert.match(migration, /before update on public\.water_treatment_plants[\s\S]*execute function public\.set_water_treatment_plant_updated_at\(\)/);
  assert.match(migration, /before update or delete on public\.water_treatment_plant_history/);
  assert.match(migration, /grant select,insert,update on public\.water_treatment_plants/);
  assert.match(migration, /grant select,insert on public\.water_treatment_plant_history/);
  assert.match(migration, /public\.business_module_enabled\(organization_id,'water_treatment'\)/);
  assert.match(migration, /public\.can_access_center\(center_id\)/);
  assert.match(migration, /create policy water_treatment_customer_read on public\.customers/);
  assert.match(migration, /array\[''sales'',''farm_services'',''water_treatment''\]/);
  assert.ok(migration.includes("case when p_write then array[''sales'',''farm_services''] else array[''sales'',''farm_services'',''water_treatment''] end"));
  assert.match(migration, /create trigger tenant_write_guard/);
  assert.match(migration, /create trigger business_operation_guard/);
});

test('Water Treatment RLS uses a restricted current-user module helper without changing other policy gates', () => {
  const migration = catalog().find(f => f.file_name === '068_water_treatment_rls_access_fix.sql').sql;
  assert.match(migration, /create or replace function public\.current_business_module_enabled\(p_module text\)\s+returns boolean\s+language sql stable security definer set search_path=public/);
  assert.match(migration, /from public\.profiles p\s+where p\.id=auth\.uid\(\)\s+and p\.is_active\s+and p\.organization_id is not null/);
  assert.match(migration, /select public\.business_module_enabled\(p\.organization_id,p_module\)/);
  assert.match(migration, /revoke all on function public\.current_business_module_enabled\(text\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.current_business_module_enabled\(text\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.business_module_enabled/);
  assert.doesNotMatch(migration, /public\.business_module_enabled\(organization_id,'water_treatment'\)/);

  const policies = [
    ['water_treatment_plants_read', 'public.water_treatment_plants', 'using'],
    ['water_treatment_plants_insert', 'public.water_treatment_plants', 'with check'],
    ['water_treatment_plants_update', 'public.water_treatment_plants', 'using'],
    ['water_treatment_plant_history_read', 'public.water_treatment_plant_history', 'using'],
    ['water_treatment_plant_history_insert', 'public.water_treatment_plant_history', 'with check'],
    ['water_treatment_customer_read', 'public.customers', 'using'],
  ];
  for (const [name, table, clause] of policies) {
    const expression = new RegExp(`alter policy ${name} on ${table}[\\s\\S]*?${clause}\\s*\\(([\\s\\S]*?)\\);`);
    const match = migration.match(expression);
    assert.ok(match, `expected altered policy ${name}`);
    assert.ok(match[1].includes("public.current_business_module_enabled('water_treatment')"));
    assert.ok(match[1].includes('organization_id=(public.current_profile()).organization_id'));
    assert.ok(match[1].includes("public.has_permission('water_treatment')"));
    assert.ok(match[1].includes('public.can_access_center(center_id)'));
  }
  assert.match(migration, /created_by=auth\.uid\(\)/);
  assert.match(migration, /recorded_by=auth\.uid\(\)/);
  assert.doesNotMatch(migration, /alter policy (tenant_boundary|business_operation_boundary|business_delete_boundary)/);
});

test('catalog rejects changed SQL, missing files, new files and reordered manifests', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'centerpro-release-'));
  try {
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    mkdirSync(path.join(dir, 'deployment/migrations'), { recursive: true });
    const manifest = { version: 1, checksum: 'sha256-utf8-lf', files: files.map(identity) };
    const save = () => writeFileSync(path.join(dir, 'deployment/migrations/manifest.json'), JSON.stringify(manifest));
    files.forEach(f => writeFileSync(path.join(dir, 'supabase/migrations', f.file_name), f.sql)); save();
    assert.equal(catalog(dir).length, 3);
    writeFileSync(path.join(dir, 'supabase/migrations', files[0].file_name), 'changed');
    assert.throws(() => catalog(dir), /Checksum/);
    writeFileSync(path.join(dir, 'supabase/migrations', files[0].file_name), files[0].sql);
    manifest.files.reverse(); save(); assert.throws(() => catalog(dir), /reordered/);
    manifest.files.reverse(); save();
    rmSync(path.join(dir, 'supabase/migrations', files[0].file_name)); assert.throws(() => catalog(dir), /Missing/);
    writeFileSync(path.join(dir, 'supabase/migrations', files[0].file_name), files[0].sql);
    writeFileSync(path.join(dir, 'supabase/migrations/004_extra.sql'), 'select 4'); assert.throws(() => catalog(dir), /extra/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ledger must be an exact checksum and ordinal prefix', () => {
  assert.equal(plan(files, rows(1)).length, 2);
  for (const change of [r => r.reverse(), r => { r[0].sha256 = 'b'.repeat(64); }, r => { r[0].ordinal = 2; }, r => r.splice(0, 1), r => { r[0].file_name = 'unknown.sql'; }]) {
    const r = rows(2); change(r); assert.throws(() => plan(files, r));
  }
});

test('target rejects wrong projects, transaction poolers, TLS overrides and absent authorization', () => {
  assert.equal(target(env, true).ssl.rejectUnauthorized, true);
  const sampleCa = '-----BEGIN CERTIFICATE-----\\nZm9v\\n-----END CERTIFICATE-----';
  assert.equal(target({ ...env, CENTERPRO_RELEASE_CA_CERT: sampleCa }, true).ssl.ca, sampleCa.replaceAll('\\n', '\n'));
  assert.equal(target({ ...env, CENTERPRO_RELEASE_CA_CERT: sampleCa.replaceAll('\\n', '\n') }, true).ssl.rejectUnauthorized, true);
  assert.throws(() => target({ ...env, CENTERPRO_RELEASE_CA_CERT: 'not a certificate' }, true), /Invalid Supabase CA certificate/);
  const readDirect = { ...env, CENTERPRO_RELEASE_DATABASE_URL: `postgres://centerpro_release_verifier@db.${ref}.supabase.co:5432/postgres` };
  const readPooler = { ...env, CENTERPRO_RELEASE_DATABASE_URL: `postgres://centerpro_release_verifier.${ref}@aws.pooler.supabase.com:5432/postgres` };
  assert.equal(target(readDirect).ssl.rejectUnauthorized, true);
  assert.equal(target(readPooler).ssl.rejectUnauthorized, true);
  assert.throws(() => target(env), /least-privilege/);
  assert.throws(() => target(readDirect, true), /least-privilege/);
  assert.throws(() => target({ ...env, CENTERPRO_RELEASE_DATABASE_URL: `postgres://postgres.${ref}@aws.pooler.supabase.com:5432/postgres` }), /least-privilege/);
  for (const url of [`postgres://postgres@localhost/db`, `postgres://postgres.${ref}@aws.pooler.supabase.com:6543/db`, env.CENTERPRO_RELEASE_DATABASE_URL + '?sslmode=disable']) {
    assert.throws(() => target({ ...env, CENTERPRO_RELEASE_DATABASE_URL: url }));
  }
  assert.throws(() => target({ ...env, CENTERPRO_RELEASE_WRITE: '' }, true));
  assert.throws(() => target({ ...env, CENTERPRO_RELEASE_PROJECT_REF: 'z'.repeat(20) }));
});

test('approval binds commit, target, manifest, recovery evidence and fresh backup', () => {
  approval(document(), files, env, 'a'.repeat(40));
  for (const update of [{ project_ref: 'bad' }, { commit: 'b'.repeat(40) }, { manifest_sha256: 'bad' }, { restore_test_ref: '' }, { deployment_gate_ref: '' }, { backup_verified_at: '2000-01-01' }, { expires_at: '2000-01-01' }]) {
    assert.throws(() => approval({ ...document(), ...update }, files, env, 'a'.repeat(40)));
  }
});

test('SQL wrapper preserves function bodies but rejects transaction escape and nontransactional operations', () => {
  assert.match(transactional("begin; do $$ begin perform 1; end $$; commit;"), /do \$\$/);
  for (const sql of ['begin; select 1; commit; select 2;', 'select 1; COMMIT;', 'vacuum;', 'create index concurrently ix on t(a);', 'set session_replication_role=replica;', '/* c */ rollback;', 'do $$unterminated']) assert.throws(() => transactional(sql));
  const f = catalog().find(f => f.file_name.startsWith('065'));
  assert.match(transactional(f.sql), /pg_get_functiondef/);
});

test('read-only verification never creates a ledger or runs application SQL', async () => {
  const db = new Database();
  assert.equal((await verify(db, files)).length, 2);
  assert.equal(db.calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert(!db.calls.some(s => /^(CREATE|INSERT|UPDATE|DELETE)/.test(s)));
  db.present = false; await assert.rejects(verify(db, files), /baseline/);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
});

test('baseline records only a reviewed prefix and never executes historical SQL', async () => {
  const db = new Database([]);
  const doc = { ...document(), baseline_count: 2, verified_files: files.slice(0, 2).map(identity) };
  await baseline(db, files, doc);
  assert.equal(db.rows.length, 2); assert(db.rows.every(r => r.origin === 'baseline'));
  assert(!db.calls.includes(files[0].sql));
  db.schemaExists = true; await assert.rejects(baseline(db, files, doc), /already exists/);
  await assert.rejects(baseline(new Database([]), files, { ...doc, verified_files: [] }), /enumerate/);
});

test('apply commits SQL and ledger together; retry skips previously committed files', async () => {
  const db = new Database();
  await apply(db, files, document());
  assert.equal(db.rows.length, 3);
  assert.equal(db.calls.filter(s => s === 'COMMIT').length, 2);
  await apply(db, files, document());
  assert.equal(db.calls.filter(s => s === files[1].sql).length, 1);
});

test('failure stops later migrations; partial release can resume from ledger', async () => {
  const db = new Database(); db.failSQL = files[2].sql;
  await assert.rejects(apply(db, files, document()));
  assert.equal(db.rows.length, 2); assert.equal(db.calls.at(-1), 'ROLLBACK');
  db.failSQL = null; await apply(db, files, document());
  assert.equal(db.rows.length, 3);
  assert.equal(db.calls.filter(s => s === files[1].sql).length, 1);
  const insertFailure = new Database(); insertFailure.failInsert = true;
  await assert.rejects(apply(insertFailure, files, document())); assert.equal(insertFailure.rows.length, 1);
  assert(!insertFailure.calls.includes(files[2].sql));
});

test('unapproved SQL and late checksum mismatch fail before first mutation', async () => {
  for (const doc of [{ ...document(), pending: [identity(files[2])] }, { ...document(), through: 'missing' }, { ...document(), pending: document().pending.reverse() }]) {
    const db = new Database(); await assert.rejects(apply(db, files, doc)); assert(!db.calls.includes('BEGIN'));
  }
  const db = new Database(rows(2)); db.rows[1].sha256 = 'bad';
  await assert.rejects(apply(db, files, document())); assert(!db.calls.includes('BEGIN'));
});

test('offline commands do not attempt connection and production gate fails without configuration', () => {
  const childEnv = { ...process.env, CENTERPRO_RELEASE_DATABASE_URL: '', CENTERPRO_RELEASE_PROJECT_REF: '' };
  const offline = spawnSync(process.execPath, ['scripts/release-migrations.mjs', 'plan'], { cwd: root, env: childEnv, encoding: 'utf8' });
  assert.equal(offline.status, 0); assert.match(offline.stdout, /OFFLINE ONLY/);
  const gate = spawnSync(process.execPath, ['scripts/production-build-gate.mjs'], { cwd: root, env: { ...childEnv, VERCEL_ENV: 'production' }, encoding: 'utf8' });
  assert.equal(gate.status, 1);
  const preview = spawnSync(process.execPath, ['scripts/production-build-gate.mjs'], { cwd: root, env: { ...childEnv, VERCEL: '1', VERCEL_ENV: 'preview' } });
  assert.equal(preview.status, 0);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.predev, 'node scripts/dev-db-setup.mjs --predev');
  assert.equal(pkg.scripts['db:setup:dev'], 'node scripts/dev-db-setup.mjs --apply');
});

test('database lock contention rejects operation before baseline or apply', async () => {
  let called = false;
  const db = { query: async (sql, values) => {
    assert.match(sql, /pg_try_advisory_lock/); assert.deepEqual(values, [82910404]);
    return { rows: [{ locked: false }] };
  } };
  await assert.rejects(exclusive(db, () => { called = true; }), /Another release/);
  assert.equal(called, false);
});

test('verification-only files are never executed and require reviewed result evidence', async () => {
  const all = files.map(f => ({ ...f })); all[1].kind = 'verification';
  const doc = { ...document(), pending: all.slice(1).map(identity) };
  const db = new Database();
  await assert.rejects(apply(db, all, doc), /evidence/);
  assert(!db.calls.includes('BEGIN'));
  doc.verification_evidence = { [all[1].file_name]: 'reviewed-results-1' };
  await apply(db, all, doc);
  assert(!db.calls.includes(all[1].sql)); assert.equal(db.rows[1].origin, 'verified');
});
