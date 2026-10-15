// CenterPro 046 source/regression guard: Sales mirrors the purchase UI operations
// while retaining sales-only accounting, inventory, prices and offline semantics.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const pos = read('app/dashboard/sales/sales-pos.tsx');
const detail = read('app/dashboard/sales/detailed-sales-entry.tsx');
const css = read('app/dashboard/sales/sales-pos.css');
const purchases = read('app/dashboard/purchases/new/purchase-form.tsx');
for(const [name, source] of [['sales-pos.tsx',pos],['detailed-sales-entry.tsx',detail],['purchase-form.tsx',purchases]]) {
 const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
 assert.equal(ast.parseDiagnostics.length,0,`${name}: TSX syntax failed: ${ast.parseDiagnostics.map(x=>x.messageText).join('; ')}`);
}
for(const check of [
 ['sale draft scoped by user', 'baseDraftKey=`sale:${scopeId}`'],
 ['load all held orders', 'listPosDrafts<SaleDraft>(baseDraftKey)'],
 ['legacy sale draft compatible', 'loadPosDraft<SaleDraft>(draftKey)'],
 ['hold current order before switching', 'await savePosDraft(draftKey,snapshot)'],
 ['unique draft keys', 'crypto.randomUUID()'],
 ['multiple-draft navigation', 'switchSalesDraft(row.key)'],
 ['temporary reference', 'draftReference'],
 ['accessible view selection', 'aria-label="Sales view"'],
 ['device-level saved view preference', 'centerpro-sales-view'],
 ['detailed view', '<DetailedSalesEntry'],
 ['consistent compact header', 'className="purchase-order-topbar sales-order-topbar"'],
 ['payments carried with draft', 'centerId,lines,payments,customerId,notes,checkout,laborSessionId,laborLoadCount,entryMode,requestId:requestId.current'],
 ['accounting RPC intact', 'confirm_center_sale_with_labor'],
 ['stock lookup intact', 'rpc("sales_stock"'],
 ['available stock constraint intact', 'const invalidLine='],
 ['customer credit rule intact', '(!credit||!!customerId)'],
 ['last confirmed selling price intact', 'function savedPrice(qualityId:string)'],
 ['bank account required', 'Select active account'],
 ['receipt pre-payment intact', '<DraftBill'],
 ['offline queue intact', 'enqueuePosTask(task)'],
 ['queued task identity isolation', 'if(task.requestId===requestId.current)'],
 ['labor session at payment', 'Labor session<select'],
 ['sales only uses sale kind', 'kind:"sale"'],
]) assert(pos.includes(check[1]),check[0]);
for(const check of ['Customer','Walk-in customer (no credit)','Stock location','Quantity (','Selling price (LKR)','Available:','onOpenPayment','savedPrice','out of stock']) {
 assert(detail.toLowerCase().includes(check.toLowerCase()),`Detailed sales missing ${check}`);
}
assert(!detail.includes('Sacks<input'), 'Do not display unsaved purchase sack quantities in sales');
assert(css.includes('.sales-detail-line'), 'Detailed responsive form styles missing');
assert(css.includes('@media(max-width:600px)'), 'Mobile detailed layout missing');
console.log('PASS: 046 Sales POS/Detailed order, customer, stock, prices, payments, drafts and offline parity guards');
