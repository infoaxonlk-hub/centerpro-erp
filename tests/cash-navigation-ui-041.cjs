/* CenterPro 041: source-only UI regression checks. Run with: node tests/cash-navigation-ui-041.cjs */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const nav = read('components/sidebar-navigation.tsx');
const cash = read('app/dashboard/cash/unified-cash.tsx');
const screen = read('app/dashboard/cash/screen.tsx');
const dashboard = read('app/dashboard/page.tsx');
const breadcrumb = read('components/context-navigation.tsx');
const users = read('app/dashboard/users/users-manager.tsx');
const cashMenu = nav.match(/\{ href: "\/dashboard\/cash", label: "Cash\/Bank Manage"[\s\S]*?\] \}/);
assert.ok(cashMenu, 'Cash/Bank Manage parent menu must exist');
assert.equal((cashMenu[0].match(/href: "\/dashboard\/cash\//g) || []).length, 2, 'Cash Management and Cash Ledger are the two submenus');
assert.ok(cashMenu[0].includes('label: "Cash Management"'), 'Cash Management submenu must exist');
assert.ok(cashMenu[0].includes('label: "Cash Ledger"'), 'Cash Ledger submenu must exist');
assert.ok(dashboard.includes('title: "Cash/Bank Manage"'), 'Dashboard card must use new name');
assert.ok(breadcrumb.includes('cash: "Cash/Bank Manage"'), 'Breadcrumb must use new name');
assert.ok(users.includes('label:"Cash/Bank Manage"'), 'User permissions label must use new name');
for (const label of ['Cash balances', 'Issue to center', 'Add Cash In', 'Cash to receive']) {
  assert.ok(cash.includes(label), `Cash management missing: ${label}`);
}
for (const label of ['Cash transfer history', 'Admin Cash In history', 'Recent cash debit / credit postings']) {
  assert.ok(!cash.includes(label), `Unrequested history panel remains: ${label}`);
}
for (const rpc of ['record_admin_cash_in', 'issue_combined_center_cash', 'receive_center_cash_with_note']) {
  assert.ok(cash.includes(rpc), `Required existing RPC must be preserved: ${rpc}`);
}
assert.ok(screen.includes('.eq("status","pending")'), 'Only actionable pending receipts should be requested');
console.log('PASS: Cash/Bank Manage -> Cash Management, balances, cash actions, pending receipts; Cash Ledger navigation.');
