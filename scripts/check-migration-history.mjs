import { execFileSync } from 'node:child_process';
import { catalog, identity, assert, root } from './release-migrations.mjs';

assert(/^[a-f0-9]{40}$/.test(process.env.BASE_SHA || ''), 'Exact base commit required');
let old;
try {
  old = JSON.parse(execFileSync('git', ['show', `${process.env.BASE_SHA}:deployment/migrations/manifest.json`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).files;
} catch {
  // First adoption: compare all SQL tracked on the PR base, not an invented empty baseline.
  const { hash, canonical } = await import('./release-migrations.mjs');
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', process.env.BASE_SHA, 'supabase/migrations'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(n => n.endsWith('.sql')).sort();
  old = names.map(name => ({ file_name: name.split('/').at(-1), sha256: hash(canonical(execFileSync('git', ['show', `${process.env.BASE_SHA}:${name}`], { cwd: root, encoding: 'utf8' }))), kind: name.includes('verify') ? 'verification' : 'migration' }));
}
const current = catalog().map(identity);
assert(JSON.stringify(current.slice(0, old.length)) === JSON.stringify(old), 'Historical migration changed, removed or reordered');
console.log('Historical migration prefix preserved.');
