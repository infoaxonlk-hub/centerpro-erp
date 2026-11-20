import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = 'centerpro_release';
const lock = 82910404;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => value.replace(/\r\n/g, '\n');
export function assert(ok, message) { if (!ok) throw new Error(message); }
export const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
export const identity = f => ({ file_name: f.file_name, sha256: f.sha256, kind: f.kind });

export function catalog(base = root) {
  const manifest = readJson(path.join(base, 'deployment/migrations/manifest.json'));
  assert(manifest.version === 1 && manifest.checksum === 'sha256-utf8-lf', 'Unsupported manifest');
  const names = readdirSync(path.join(base, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort();
  assert(JSON.stringify(names) === JSON.stringify(manifest.files.map(f => f.file_name)), 'Missing, extra, duplicate or reordered migration');
  return manifest.files.map(f => {
    const sql = canonical(readFileSync(path.join(base, 'supabase/migrations', f.file_name), 'utf8'));
    assert(/^[a-f0-9]{64}$/.test(f.sha256) && hash(sql) === f.sha256, `Checksum mismatch: ${f.file_name}`);
    assert(['migration', 'verification'].includes(f.kind), 'Invalid migration kind');
    return { ...identity(f), sql };
  });
}

// Lex only top-level statements. Function bodies, strings and comments are opaque.
export function statements(sql) {
  const result = []; let text = '';
  for (let i = 0; i < sql.length;) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; text += ' '; continue; }
    if (rest.startsWith('/*')) {
      let depth = 1; i += 2;
      while (depth && i < sql.length) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2; }
        else if (sql.slice(i, i + 2) === '*/') { depth--; i += 2; }
        else i++;
      }
      assert(!depth, 'Unterminated SQL comment'); text += ' '; continue;
    }
    const dollar = rest.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) { const end = sql.indexOf(dollar, i + dollar.length); assert(end >= 0, 'Unterminated dollar quote'); text += ' BODY '; i = end + dollar.length; continue; }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]; let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === quote) { if (sql[i] === quote) i++; else { closed = true; break; } }
      }
      assert(closed, 'Unterminated SQL quote'); text += ' VALUE '; continue;
    }
    if (sql[i] === ';') { if (text.trim()) result.push(text.trim()); text = ''; i++; }
    else text += sql[i++];
  }
  if (text.trim()) result.push(text.trim());
  return result;
}

export function transactional(sql) {
  // Remove only an exact, reviewed outer wrapper; never strip procedural BEGIN/END.
  const wrapper = sql.match(/^\s*(?:--[^\n]*\n\s*)*begin\s*;([\s\S]*)commit\s*;\s*$/i);
  const body = wrapper ? wrapper[1] : sql;
  for (const statement of statements(body)) {
    assert(!/^(begin|commit|rollback|end|abort|start\s+transaction|prepare\s+transaction|savepoint|release|set|reset|discard|vacuum|copy|\\)/i.test(statement), 'Unsupported transaction/session control');
    assert(!/\bconcurrently\b/i.test(statement), 'Nontransactional SQL needs a separate reviewed procedure');
  }
  return body;
}

export function plan(files, rows) {
  assert(rows.length <= files.length, 'Ledger is ahead of source');
  rows.forEach((row, i) => {
    assert(row.ordinal === i + 1 && JSON.stringify(identity(row)) === JSON.stringify(identity(files[i])), 'Ledger missing, changed or reordered');
    assert(['baseline', 'executed', 'verified'].includes(row.origin), 'Invalid ledger origin');
  });
  return files.slice(rows.length);
}

export function target(env, write = false) {
  const ref = env.CENTERPRO_RELEASE_PROJECT_REF;
  assert(/^[a-z0-9]{20}$/.test(ref || ''), 'Expected project reference required');
  let url;
  try { url = new URL(env.CENTERPRO_RELEASE_DATABASE_URL); } catch { throw new Error('Release connection configuration required'); }
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'Invalid connection protocol');
  const username = decodeURIComponent(url.username);
  const expectedRole = write ? 'postgres' : 'centerpro_release_verifier';
  const direct = url.hostname === `db.${ref}.supabase.co` && (url.port === '' || url.port === '5432') && username === expectedRole;
  const session = url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432' && username === `${expectedRole}.${ref}`;
  assert(direct || session, 'Expected target and least-privilege database role required');
  assert(!url.search, 'Connection URL parameters forbidden; TLS verification is enforced');
  if (write) assert(env.CENTERPRO_RELEASE_WRITE === 'approved-production-release', 'Write authorization required');
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000, application_name: 'centerpro-release' };
}

export async function history(db) {
  const exists = await db.query("SELECT to_regclass('centerpro_release.applied_migrations') IS NOT NULL AS present");
  assert(exists.rows[0].present, 'No release baseline: reconcile history before applying SQL');
  return (await db.query(`SELECT ordinal,file_name,sha256,kind,origin FROM ${schema}.applied_migrations ORDER BY ordinal`)).rows;
}

export async function verify(db, files) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try { const pending = plan(files, await history(db)); await db.query('COMMIT'); return pending; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
}

export async function exclusive(db, operation) {
  const result = await db.query('SELECT pg_try_advisory_lock($1) AS locked', [lock]);
  assert(result.rows[0].locked, 'Another release owns the database lock');
  // The caller closes this dedicated session in finally, including on failure.
  return operation();
}

export function approval(document, files, env, revision, now = Date.now()) {
  assert(document.version === 1 && document.project_ref === env.CENTERPRO_RELEASE_PROJECT_REF, 'Approval target mismatch');
  assert(document.commit === revision && /^[a-f0-9]{40}$/.test(revision), 'Approval commit mismatch');
  assert(document.manifest_sha256 === hash(JSON.stringify(files.map(identity))), 'Approval manifest mismatch');
  for (const field of ['approved_by', 'evidence_ref', 'backup_ref', 'restore_test_ref', 'recovery_plan_ref', 'deployment_gate_ref']) {
    assert(typeof document[field] === 'string' && document[field].trim().length > 3, `Missing approval evidence: ${field}`);
  }
  const age = now - Date.parse(document.backup_verified_at);
  assert(Number.isFinite(age) && age >= 0 && age <= 24 * 3600000, 'Backup verification must be within 24 hours');
  assert(Date.parse(document.expires_at) > now && Date.parse(document.expires_at) <= now + 24 * 3600000, 'Approval expired or exceeds 24 hours');
}

async function record(db, f, ordinal, origin, document) {
  await db.query(`INSERT INTO ${schema}.applied_migrations(ordinal,file_name,sha256,kind,origin,release_commit,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)`, [ordinal, f.file_name, f.sha256, f.kind, origin, document.commit, JSON.stringify(document)]);
}

export async function baseline(db, files, document) {
  assert(Number.isInteger(document.baseline_count) && document.baseline_count > 0 && document.baseline_count <= files.length, 'Explicit verified baseline prefix required');
  assert(Array.isArray(document.verified_files) && JSON.stringify(document.verified_files) === JSON.stringify(files.slice(0, document.baseline_count).map(identity)), 'Baseline evidence must enumerate the verified prefix');
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='12s'; SET LOCAL statement_timeout='240s'");
    const exists = await db.query("SELECT to_regnamespace('centerpro_release') IS NOT NULL AS present");
    assert(!exists.rows[0].present, 'Release schema already exists; never overwrite a baseline');
    await db.query(`CREATE SCHEMA ${schema}; REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC,anon,authenticated,service_role;
      CREATE TABLE ${schema}.applied_migrations(ordinal integer PRIMARY KEY CHECK(ordinal>0),file_name text UNIQUE NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),kind text NOT NULL CHECK(kind IN ('migration','verification')),origin text NOT NULL CHECK(origin IN ('baseline','executed','verified')),release_commit text NOT NULL,evidence jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
      REVOKE ALL ON ${schema}.applied_migrations FROM PUBLIC,anon,authenticated,service_role;
      ALTER TABLE ${schema}.applied_migrations ENABLE ROW LEVEL SECURITY`);
    for (let i = 0; i < document.baseline_count; i++) await record(db, files[i], i + 1, 'baseline', document);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}

export async function apply(db, files, document) {
  const rows = await history(db);
  const pending = plan(files, rows);
  const end = document.through;
  const endIndex = files.findIndex(f => f.file_name === end);
  assert(endIndex >= 0, 'Explicit release through filename required');
  const approved = files.slice(0, endIndex + 1).filter(f => !rows.some(r => r.file_name === f.file_name));
  // Keep the same document valid after a partial run; never execute beyond its approved prefix.
  assert(Array.isArray(document.pending) && document.pending.every((f, i, a) => {
    const index = files.findIndex(x => x.file_name === f.file_name);
    return index >= 0 && index <= endIndex && JSON.stringify(f) === JSON.stringify(identity(files[index])) && (!i || index === files.findIndex(x => x.file_name === a[i - 1].file_name) + 1);
  }), 'Invalid approved migration identities');
  assert(approved.every(f => document.pending.some(p => JSON.stringify(p) === JSON.stringify(identity(f)))), 'Unapproved pending migration');
  assert(!document.pending.length || document.pending.at(-1).file_name === end, 'Approval must end at through');
  for (const f of approved.filter(f => f.kind === 'verification')) {
    assert(typeof document.verification_evidence?.[f.file_name] === 'string' && document.verification_evidence[f.file_name].length > 3, 'Verification file requires reviewed read-only result evidence');
  }
  const bodies = approved.map(f => f.kind === 'migration' ? transactional(f.sql) : null); // Validate all before first mutation.
  for (let i = 0; i < approved.length; i++) {
    await db.query('BEGIN');
    try {
      await db.query("SET LOCAL lock_timeout='12s'; SET LOCAL statement_timeout='240s'");
      if (bodies[i] !== null) await db.query(bodies[i]);
      await record(db, approved[i], files.indexOf(approved[i]) + 1, bodies[i] === null ? 'verified' : 'executed', document);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }
  return pending.length - approved.length;
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const [mode = 'plan', documentPath] = argv;
  assert(['plan', 'verify', 'baseline', 'apply'].includes(mode) && argv.length <= 2, 'Expected plan|verify|baseline|apply [approval.json]');
  const files = catalog();
  if (mode === 'plan') {
    console.log(JSON.stringify({ manifest_sha256: hash(JSON.stringify(files.map(identity))), files: files.map(identity), status: 'OFFLINE ONLY: database state unknown' }, null, 2)); return;
  }
  const write = ['baseline', 'apply'].includes(mode);
  const configuration = target(env, write);
  let document;
  if (write) {
    document = readJson(documentPath);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    assert(!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), 'Release requires a clean checkout');
    approval(document, files, env, revision);
  }
  const { default: pg } = await import('pg');
  const db = new pg.Client(configuration);
  try {
    await db.connect();
    if (!write) {
      const pending = await verify(db, files);
      console.log(JSON.stringify({ pending: pending.map(identity) }, null, 2));
      assert(!pending.length, 'Database is behind this release; publication blocked');
    } else {
      await exclusive(db, () => mode === 'baseline' ? baseline(db, files, document) : apply(db, files, document));
      console.log('Approved operation completed. Run read-only verification and release smoke checks.');
    }
  } finally { await db.end().catch(() => {}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(() => { console.error('Release stopped. Check target, manifest, ledger and approval. Database details suppressed; investigate through restricted operator logs.'); process.exitCode = 1; });
}
