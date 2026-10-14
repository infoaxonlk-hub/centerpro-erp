const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function read(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(parsed.parseDiagnostics.length, 0, `${relativePath}: invalid TSX`);
  return source;
}
const detailed = read('app/dashboard/purchases/new/detailed-purchase-entry.tsx');
const form = read('app/dashboard/purchases/new/purchase-form.tsx');
const page = read('app/dashboard/purchases/new/page.tsx');
assert(!detailed.includes('detail-labor-section'), 'Remove labor section from Enter Weights screen');
assert(!detailed.includes('laborSessionId'), 'Detailed view should not manage labor state');
assert(!form.includes('onLaborSessionChange='), 'Do not pass labor editing handlers to Detailed view');
assert(!page.includes('canManageLabor='), 'Unused page prop should be removed');
assert(form.includes('className="pos-payment-screen"'), 'Payment Window should remain');
const paymentPos = form.indexOf('className="pos-payment-screen"');
const laborPos = form.indexOf('className="labor-pos-fields"');
assert(paymentPos > 0 && laborPos > paymentPos, 'Labor controls must be located inside Payment Window');
assert(form.includes('value={laborSessionId}'), 'Keep labor session selection state');
assert(form.includes('setLaborLoadCount(e.target.value)'), 'Keep loads input in Payment Window');
assert(form.includes('p_labor_session: task.payload.laborSessionId'), 'Keep labor session RPC payload');
assert(form.includes('p_load_count: task.payload.laborLoadCount'), 'Keep labor loads RPC payload');
console.log('PASS: 044d labor input only in payment, and purchase labor RPC unchanged');
