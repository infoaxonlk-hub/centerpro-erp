import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, hash, hashExact, hashCrlf, matchesAppliedMigrationChecksum } from '../scripts/migration-checksum.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('checksum helpers retain canonical LF hashing and distinguish exact LF and CRLF content', () => {
  const lf = 'select 1;\nselect 2;\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(canonical(crlf), lf);
  assert.equal(hash(crlf), hash(lf));
  assert.equal(hashExact(lf), hash(lf));
  assert.notEqual(hashExact(crlf), hashExact(lf));
  assert.equal(hashCrlf(lf), hashExact(crlf));
});

test('previously applied LF, raw, and CRLF-normalized migration checksums are accepted', () => {
  const lf = 'create table example(id int);\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(matchesAppliedMigrationChecksum(hash(lf), lf), true);
  assert.equal(matchesAppliedMigrationChecksum(hashExact(lf), lf), true);
  assert.equal(matchesAppliedMigrationChecksum(hashExact(crlf), lf), true);
  assert.equal(matchesAppliedMigrationChecksum(hashCrlf(lf), lf), true);
});

test('changed SQL does not match any checksum of the original migration', () => {
  const original = 'create table example(id int);\n';
  const changed = 'create table example(id bigint);\n';
  for (const stored of [hash(original), hashExact(original), hashCrlf(original)]) {
    assert.equal(matchesAppliedMigrationChecksum(stored, changed), false);
  }
});

test('development runner accepts legacy hashes only for history validation and records new hashes canonically', () => {
  const runner = readFileSync(path.join(root, 'scripts/dev-db-setup.mjs'), 'utf8');
  assert.match(runner, /if \(!matchesAppliedMigrationChecksum\(history\.get\(f\.name\),f\.sql\)\) fail\("Applied migration changed: "\+f\.name\)/);
  assert.match(runner, /VALUES\(\$1,\$2\)"\,\[f\.name,f\.sha256\]/);
  assert.match(runner, /sha256:hash\(sql\)/);
});
