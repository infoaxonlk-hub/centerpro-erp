#!/usr/bin/env node
// 045: read-only UI structure regression checks; does not replace a Next.js build.
const fs = require('fs');
function get(p){return fs.readFileSync(p,'utf8')}
function ensure(ok,description){if(!ok){console.error('FAIL '+description);process.exitCode=1}else console.log('PASS '+description)}
const nav=get('app/compact-nav-filters.css');
const layout=get('app/layout.tsx');
const purchase=get('app/dashboard/purchases/page.tsx');
ensure(layout.includes('compact-nav-filters.css'),'Compact responsive stylesheet loaded');
ensure(nav.includes('.module-cards')&&nav.includes('overflow-x:auto'),'Navigation scrolls horizontally without giant pills');
ensure(purchase.includes('name="q"')&&purchase.includes('cp-filter-toolbar'),'Purchase quick search stays visible');
ensure(purchase.includes('cp-filter-details')&&purchase.includes('cp-filter-count'),'Purchase advanced filters collapse with active count');
ensure(['center','supplier','method','status','from','to'].every(n=>purchase.includes('name="'+n+'"')),'All purchase filter parameters preserved');
for(const p of ['app/dashboard/stock/stock-view.tsx','app/dashboard/expenses/expense-manager.tsx','app/dashboard/sales/sales-manager.tsx','app/dashboard/payment-reports/split-report.tsx','app/dashboard/cash/ledger/page.tsx','app/dashboard/bank/statement/page.tsx']){
 ensure(get(p).includes('cp-filter-details'),p+' filters have disclosure');
}
ensure(!fs.existsSync('supabase/migrations/045_compact_filters.sql'),'No database migration required');
