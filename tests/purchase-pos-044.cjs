const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const files = [
  'app/dashboard/purchases/new/purchase-form.tsx',
  'app/dashboard/purchases/new/detailed-purchase-entry.tsx',
  'app/dashboard/purchases/new/page.tsx',
  'lib/offline-pos.ts',
  'lib/purchase-quantity-summary.ts',
];
for (const file of files) {
  const absolute = path.join(root, file);
  const source = fs.readFileSync(absolute, 'utf8');
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(syntax.parseDiagnostics.length, 0, `Syntax errors in ${file}`);
}
const form = fs.readFileSync(path.join(root, files[0]), 'utf8');
const detailed = fs.readFileSync(path.join(root, files[1]), 'utf8');
const store = fs.readFileSync(path.join(root, 'lib/offline-pos.ts'), 'utf8');
assert(form.includes('Hold & new purchase'));
assert(form.includes('listPosDrafts<PurchaseDraft>'));
assert(form.includes('await savePosDraft(draftKey, snapshot)'));
assert(form.includes('quantityWithUnits'));
assert(!form.includes('<small>Paid (excl. credit)</small>'));
assert(!form.includes('<small>Credit balance</small>'));
assert(form.includes('Math.abs(allocationDifference) > 0.001'), 'Payment validation must remain');
assert(detailed.includes('Purchase labor session'));
assert(detailed.includes('onLaborSessionChange'));
assert(store.includes('row.key === baseKey || row.key.startsWith(`${baseKey}:`)'));
const code = fs.readFileSync(path.join(root, 'lib/purchase-quantity-summary.ts'), 'utf8');
const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleShim = {exports: {}};
new Function('module', 'exports', js)(moduleShim, moduleShim.exports);
const {formatPurchaseQuantityByUnit} = moduleShim.exports;
assert.equal(formatPurchaseQuantityByUnit([
  {product_id:'a', quantity:10.5}, {product_id:'b',quantity:2}, {product_id:'a', quantity:3}
], [{id:'a',unit_of_measure:'KG'},{id:'b',unit_of_measure:'PCS'}]), '13.5 KG · 2 PCS');
assert.equal(formatPurchaseQuantityByUnit([], []), '0');
console.log('PASS: CenterPro 044 purchase UI, multi-draft, labor and UOM checks');
