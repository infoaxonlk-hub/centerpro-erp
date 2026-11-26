import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, hashExact } from '../scripts/migration-checksum.mjs';
import { appliedMigrationsSelect, verifyMigrationHistory } from '../scripts/dev-db-verify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = (name, sql) => ({ name, sql, sha256: hash(sql) });

function readonlyFixture(rows) {
  const statements = [];
  return {
    statements,
    async query(statement) {
      statements.push(statement);
      assert.equal(statement, appliedMigrationsSelect, 'verification may issue only the history SELECT');
      return { rows };
    },
  };
}

test('verification passes when every applied migration checksum matches', async () => {
  const migrations = [local('001_init.sql', 'select 1;\n'), local('002_more.sql', 'select 2;\n')];
  const db = readonlyFixture(migrations.map(file => ({ file_name: file.name, sha256: file.sha256 })));
  const result = await verifyMigrationHistory(db, migrations);
  assert.deepEqual(result, { appliedVerifiedCount: 2, pending: [], missingLocalFiles: [], checksumMismatches: [], pass: true });
  assert.deepEqual(db.statements, [appliedMigrationsSelect]);
});

test('verification accepts legacy CRLF checksums and reports unapplied local migrations as pending', async () => {
  const sql = 'select 1;\nselect 2;\n';
  const migration = local('001_init.sql', sql);
  const pending = local('002_pending.sql', 'select 3;\n');
  const db = readonlyFixture([{ file_name: migration.name, sha256: hashExact(sql.replace(/\n/g, '\r\n')) }]);
  const result = await verifyMigrationHistory(db, [migration, pending]);
  assert.deepEqual(result, { appliedVerifiedCount: 1, pending: [pending.name], missingLocalFiles: [], checksumMismatches: [], pass: true });
});

test('verification reports changed SQL as a checksum mismatch', async () => {
  const migration = local('001_changed.sql', 'select 2;\n');
  const db = readonlyFixture([{ file_name: migration.name, sha256: hash('select 1;\n') }]);
  const result = await verifyMigrationHistory(db, [migration]);
  assert.deepEqual(result, { appliedVerifiedCount: 0, pending: [], missingLocalFiles: [], checksumMismatches: [migration.name], pass: false });
});

test('verification reports database history entries whose local migration files are missing', async () => {
  const db = readonlyFixture([{ file_name: '009_removed.sql', sha256: 'a'.repeat(64) }]);
  const result = await verifyMigrationHistory(db, [local('001_init.sql', 'select 1;\n')]);
  assert.deepEqual(result, { appliedVerifiedCount: 0, pending: ['001_init.sql'], missingLocalFiles: ['009_removed.sql'], checksumMismatches: [], pass: false });
});

test('missing migration history table is reported clearly without trying to create it', async () => {
  for (const code of ['42P01', '3F000']) {
    const statements = [];
    const db = { async query(statement) { statements.push(statement); const error = new Error('relation missing'); error.code = code; throw error; } };
    await assert.rejects(verifyMigrationHistory(db, []), /Migration history table centerpro_setup\.applied_migrations is missing/);
    assert.deepEqual(statements, [appliedMigrationsSelect]);
  }
});

test('verify command uses target validation, read-only verifier, and closes its client', () => {
  const runner = readFileSync(path.join(root, 'scripts/dev-db-setup.mjs'), 'utf8');
  assert.match(runner, /if \(argv\.includes\("--verify"\)\)\s*\{\s*const target=verifyTarget\(\)/);
  assert.match(runner, /const result=await verifyMigrationHistory\(db,files\)/);
  assert.match(runner, /finally\s*\{\s*await db\.end\(\)\.catch\(\(\)=>\{\}\);\s*\}/);
  assert.match(runner, /if \(!argv\.includes\("--apply"\) && !argv\.includes\("--predev"\)\) fail\("Pass --plan, --verify, or --apply\."\)/);
});
