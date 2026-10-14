const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const file = 'app/dashboard/purchases/new/purchase-form.tsx';
const source = fs.readFileSync(path.join(root, file), 'utf8');
const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(parsed.parseDiagnostics.length, 0, 'Purchase form syntax must be valid');
for (const expected of [
  'aria-label="Purchase view"',
  '<option value="detailed">Detailed</option>',
  'changeEntryMode(e.target.value as "pos" | "detailed")',
  'localStorage.setItem("centerpro-purchase-view", mode)',
  'savedPurchasePreference !== "detailed"',
  '<DetailedPurchaseEntry',
  'Hold & new purchase',
  'quantityWithUnits',
]) assert(source.includes(expected), `Missing view restoration behavior: ${expected}`);
console.log('PASS: Detailed Purchase Order view selector and draft preference safety');
