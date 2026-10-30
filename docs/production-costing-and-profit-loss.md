# Production valuation and management P&L

## Accounting boundary and active method

CenterPro has cash and bank double-entry **subledgers**, but no full chart of accounts, WIP/inventory general-ledger posting engine, or prior P&L report. Migration 056 extends the existing stock movement/physical lot allocation ledger; it does not invent GL accounts, duplicate payments, or create supplier bills. The new Payments → Profit & Loss page is an accrual **management** report over recorded sales, valuation movements and expenses, not a statutory financial statement.

The active forward valuation method is **oldest physical lot allocation, weighted remaining cost within each lot** (and within Unassigned / Legacy stock). Selecting a manufacturing source lot consumes that lot's remaining recorded quantity/value. Reusing a lot blends its additional receipts into its remaining weighted value; it does not use the oldest original receipt price, latest purchase default, or selling price. Unselected manufacturing and sales consume deterministic oldest received lots, with Legacy first, using the existing physical allocation order. Product-level FIFO/AVCO selection remains future policy configuration; 056 does not activate a configurable per-product FIFO receipt-layer engine.

`stock_movements.inventory_value` and signed `stock_lot_allocations.inventory_value` are authoritative at six decimal places. Unit costs are six-decimal display/snapshot rates; never reconstruct exact value by multiplying a rounded unit rate. Sales lines persist exact `cogs_value`. Full consumption or reversal carries the remaining rounding residue so stock cannot retain a rounding balance after the last unit leaves. Receipt identities, quantities, sacks, payment records and historical economic costs are preserved.

## Production cost sources

- Raw material and packaging costs come from actual consumed physical stock allocations. Each immutable cost entry links to its input, movement, selected source lot and actual per-lot allocation/value snapshot.
- Operation cost is actual input KG × rate, actual hours × rate, or the configured per-batch amount. G inputs convert to KG. For per-KG labor or external milling, count-based inputs require a suitable hourly/batch method or a weight-based material product; they are not silently treated as kilograms.
- External milling adds actual input KG × external rate **in addition to** separately configured operation/labor cost. On external orders, enter only additional operations in the operation field. Previously completed orders are not recalculated.
- An existing labor-session wage expense or external-service expense can be selected as the source. Its recorded amount **replaces** the corresponding rate-derived charge; it is not added a second time. One whole expense may be capitalized only once, into one order, in the same tenant and center. Split/shared expense allocation is not implemented: use separately recorded attributable expenses rather than linking the same total twice.
- Linking recorded expenses requires existing Expenses entitlement and cash/expense access. A linked expense cannot be future dated. Its amount, date and business/center become immutable after capitalization; settlement/payment status may still follow the existing expense workflow.
- Rate-only charges are explicitly identified as **capitalized conversion accruals**. Completion creates no cash movement, expense, supplier payable or GL journal. They represent an operator-confirmed additional cost, not a second copy of an existing expense. Record a pre-existing wage/service bill through the expense-source option. Later settlement/reconciliation of an unlinked accrual requires a future accounting workflow; do not record the same cost again as an unrelated operating expense.

Drafts save plans/source IDs only. Completion atomically locks the order/stock, consumes actual material, snapshots charges, creates output lots, allocates cost and posts stock value. Failure rolls all of it back. Repeating completion returns the existing order without reposting.

## Output allocation

The existing `cost_share_percent` fields are now editable in the production form. When any share is specified, shares must total 100%. Otherwise costs follow accepted output quantities (G converted to KG), or accepted packed weight for packing. Mixed weight/count output units require explicit shares. Rounding residue goes to the last positive-share output. The existing output `line_cost`, `unit_cost`, stock movement and output lot IDs form an immutable completion snapshot; no second output-cost table is introduced.

Example: consume 4 KG from a lot costing LKR 30/KG and record 2 labor hours × LKR 5. Total is LKR 130. With 75% main/25% by-product shares, accepted outputs 3 KG and 1 KG receive LKR 97.50 and LKR 32.50, each costing LKR 32.50/KG. Before sale, all LKR 130 remains in inventory. Selling 1 KG of main output for LKR 100 records COGS LKR 32.50 and gross profit LKR 67.50. Remaining main stock is 2 KG/LKR 65 plus by-product 1 KG/LKR 32.50.

Packing follows the same ledger: consumed bulk rice + empty bags + actual packing operation cost become packed-product inventory value. No entire production-cost expense is booked at completion.

## Management P&L

`profit_loss_report(from,to,center)` enforces Payment Reports, Sales, Inventory and Expenses access, tenant isolation and permitted centers. Dates use Sri Lanka time. It reports original sales-line revenue less approved returns and cancellations on their transaction dates; cash/credit collections are not new revenue. COGS follows sales outflows less exact cost reversals. Unsold stock and transfers do not create COGS. Recorded expenses are reduced by expense amounts capitalized on completion; no duplicate expense or cash posting is created. Scrap losses are shown separately. Closing inventory uses exact signed movement values through the end date.

Gross profit = net sales revenue − net sales COGS. Purchase returns/cancellations remove current carrying value while preserving the historical supplier credit; the difference is an explicit purchase-cost variance, preventing stranded stock value after a blended lot is emptied. Net operating profit = gross profit − recorded expenses + capitalized expense reclassifications − scrap loss + purchase-cost variance. Taxes, depreciation, financing, general-ledger adjustments, unrecorded costs and unexplained stock-count gains/losses are outside this management report. A past-period expense linked today is reclassified today; prior financial periods are not silently rewritten.

Historical balances are initialized from **recorded** movement costs, and historical sales COGS from their recorded line costs. Existing pre-051 allocation gaps remain Unassigned / Legacy. Earlier completed production rounding and pre-056 pooled-cost sales are not retrospectively reconstructed, corrected or revalued. Historical P&L can only reflect those existing records. New movement/lot values and completion snapshots are authoritative from 056 onward.

## Setup and local verification

After migrations through 055, apply the entire `supabase/migrations/056_production_valuation_and_profit_loss.sql` once in Supabase SQL Editor. It runs in a transaction and reloads PostgREST schema. It needs the migration/database owner role, locks stock during the conversion, and includes a historical valuation backfill; schedule it outside active stock posting. No remote migration is executed by the implementation.

For VS Code PowerShell:

```powershell
git switch development
npm ci
$testDeps = Join-Path $env:TEMP 'centerpro-lot-tests'
npm install --prefix $testDeps --no-save @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $testDeps 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/production-costing-database.mjs
node tests/manufacturing-database.mjs
node tests/product-defaults-lot-balances.mjs
node tests/product-sacks-database.mjs
node tests/purchase-lots-database.mjs
node tests/product-process-database.mjs
node tests/business-access-database.mjs
node tests/production-cost-preview.cjs
node tests/manufacturing-ui.cjs
node tests/product-process-ui.cjs
node tests/product-price-ui.cjs
node tests/purchase-lots-offline.cjs
npm run build
```

These database tests use isolated PGlite PostgreSQL with Supabase auth/storage fixtures; they never connect to the remote database. See [manual QA](qa/production-costing-test-cases.md) before production promotion.

## Verification recorded on 2026-10-30

- Passed the 12 scripts above, plus `tests/purchase-detailed-view-044b.cjs` and `tests/session-access-regression.cjs` (14 scripts).
- Production build passed: Next.js compilation, TypeScript and all 58 page entries, including Profit & Loss.
- The costing fixture reconciles final sales revenue 1,320, COGS 347.50, gross profit 972.50, zero duplicated operating expense, scrap 32.50, purchase-cost variance −100, net operating profit 840 and closing stock 375. It also checks exact movement/allocation reconciliation, completion retry and failure rollback.
- Targeted ESLint passed with the existing `react-hooks/set-state-in-effect` rule excluded. This is not a claim that the entire repository passes unrestricted lint.
- No remote SQL migration or authenticated Preview/accounting UI session was run. Historical limitations and the non-GL accounting boundary above remain applicable.
