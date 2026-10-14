const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(name, kind = ts.ScriptKind.TSX) {
  const code = fs.readFileSync(path.join(root, name), 'utf8');
  const parsed = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, kind);
  assert.equal(parsed.parseDiagnostics.length, 0, `Syntax errors in ${name}: ${parsed.parseDiagnostics.map(e=>e.messageText).join(', ')}`);
  return code;
}
const form = load('app/dashboard/purchases/new/purchase-form.tsx');
const detailed = load('app/dashboard/purchases/new/detailed-purchase-entry.tsx');
const css = fs.readFileSync(path.join(root, 'app/purchase-pos.css'), 'utf8');
assert(form.includes('className="purchase-order-topbar"'), 'compact draft bar missing');
assert(form.includes('Layers3 size={19}'), 'meaningful drafts icon missing');
assert(form.includes('aria-label="Hold & new purchase"'), 'hold + new action missing');
assert(form.includes('await savePosDraft(draftKey, snapshot)'), 'draft saving missing');
assert(form.includes('draftReference'), 'draft order reference missing');
assert(form.includes('Temporary draft reference'), 'draft must not be mistaken for an official purchase number');
assert(form.includes('aria-label="Purchase view"'), 'POS/Detailed selector missing');
assert(!form.includes('className="purchase-draft-toolbar"'), 'oversized draft card still present');
assert(detailed.includes('!showProductPicker && <section className="detail-labor-section"'), 'labor must not appear while choosing products');
assert(detailed.indexOf('detail-labor-section') > detailed.indexOf('detail-weight-sections'), 'labor should follow weighing');
assert(form.includes('className="labor-pos-fields"'), 'payment labor selection must remain');
assert(css.includes('.purchase-drafts-popover'), 'overlay style missing');
assert(css.includes('@media(max-width:520px){.purchase-order-topbar'), 'mobile compact bar style missing');
console.log('PASS: 044c compact order bar, held draft menu, labor placement, and UI syntax');
