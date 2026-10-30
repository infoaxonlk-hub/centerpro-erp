# Purchase lots — Phase 1

Changes are prepared on the development branch for Preview testing. Production promotion and remote migrations are handled separately.

Update: migration 054 replaces the original split-row behavior below with one lot and one total weighing per product per purchase. Historical confirmed split receipts are retained. See [current process and receipt QA](qa/product-process-and-purchase-lot-test-cases.md) for current rules and held/offline draft correction.

## Behavior

- Products & Suppliers → create/edit → **Track purchase lots**. Existing products remain disabled. Sack tracking is independent.
- Enabled purchase rows expose **Lot / Batch** in POS and Detailed entry: generate on confirmation, enter a number, or search existing lots. Search is scoped to the signed-in business, product and quality and shows up to 20 matches; narrow the search for more specific results.
- Lot numbers are trimmed and uppercased. A manual number matching an existing lot in that business/product/quality reuses its identity. The same label in another product or quality is a separate lot.
- **Split quantity into another lot row** subtracts the new quantity and sacks from the original row. Positive quantities use at most three decimals; sack-tracked rows each need at least one sack. Unit prices are retained. The remaining row keeps its lot choice; the new row defaults to a newly generated lot.
- Payment totals use the existing database's per-line rounding. A split can affect the final cent due to that existing rounding rule; no unit-price, stock-cost, payment-posting, sack-ledger or labor calculation is changed in SQL.
- Held drafts and offline tasks retain lot choices. Existing offline tasks without choices still sync: enabled products default to a generated lot. Searching requires connectivity; saved existing selections and typed numbers can be queued offline. The server validates everything again on sync.
- Existing request-ID locking and purchase idempotency are retained. A lost response followed by retry returns the already-posted purchase without creating another lot or receipt, even if its labor session has since closed.
- Purchases → **Lot receipts** searches lot numbers and paginates 24 receipts at a time. Purchase details show all related lot receipts. These show **original received quantities**, not available stock. Cancelled purchases are labelled; cancellations and returns do not rewrite receipt history.

## Data and access

Migration `050_purchase_lots.sql` adds the product flag, a confirmation-time line snapshot, `purchase_lots`, `purchase_lot_receipts`, the auto-number sequence and `confirm_queued_purchase_with_lots`.

Each receipt stores its purchase/line, center/location, product/quality, original quantity, unit of measure, unit purchase price and confirmation timestamp. Reusing a lot never updates prior receipts. Lot identity and receipts are immutable; authenticated clients have SELECT access only. Confirmed line dimensions/assignments are protected. Legacy confirmation endpoints cannot confirm newly tracked lines without receipts.

Receipt access follows business, purchases permission/module/subscription and assigned-center restrictions. Lot-number metadata is shared across purchase users in the same business/product/quality; this does not grant access to other centers' receipt quantities or prices. Internal routines retain the existing tenant/business write guards.

There is no outbound lot allocation, available-lot balance, FIFO/average costing change, opening-stock backfill, journal or P&L work in Phase 1.

## Exact local commands (PowerShell)

```powershell
Set-Location 'D:\Infoaxon\Project\centerpro-erp'
git switch development
npm ci

# Isolated in-memory PostgreSQL tests. This does not connect to Supabase.
$lotTestRoot = Join-Path $env:TEMP 'centerpro-lot-tests'
npm install --prefix $lotTestRoot --no-save --package-lock=false @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $lotTestRoot 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/purchase-lots-database.mjs
node tests/purchase-lots-offline.cjs
node tests/product-sacks-database.mjs
node tests/business-access-database.mjs
node tests/navigation-regression.cjs
node tests/purchase-detailed-view-044b.cjs
node tests/purchase-pos-044.cjs
npm run build
```

`PGLITE_MODULE` can instead point to an existing PGlite installation. Browser verification during implementation used disposable local fixtures and mocked Supabase responses; no remote bill was posted. The fixtures have been removed.

## Apply SQL to a local Supabase database

1. Ensure that local database has migrations through **049**. Back up any local data you need. No reset/backfill is required.
2. Open `supabase/migrations/050_purchase_lots.sql` and run the complete file once in your **local** Supabase Studio SQL Editor. It is transactional. Do not rerun an already applied migration.
3. Alternatively, if `psql` is installed and your local Supabase uses its standard database port and credentials:

```powershell
Set-Location 'D:\Infoaxon\Project\centerpro-erp'
$env:CENTERPRO_LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
psql $env:CENTERPRO_LOCAL_DATABASE_URL -v ON_ERROR_STOP=1 -f '.\supabase\migrations\050_purchase_lots.sql'
```

Use your actual **local** connection string if its port/credentials differ. These commands were not run against a remote database. `psql` and Supabase CLI are not installed in the implementation environment; migration execution was verified through PGlite.

4. Verify in local SQL Editor:

```sql
select column_name, column_default
from information_schema.columns
where table_schema='public' and table_name='products'
  and column_name='tracks_purchase_lots';
select to_regclass('public.purchase_lots'), to_regclass('public.purchase_lot_receipts');
select to_regprocedure('public.confirm_queued_purchase_with_lots(uuid,uuid,uuid,text,jsonb,jsonb,uuid,integer,boolean,jsonb,boolean)');
notify pgrst, 'reload schema';
```

5. Point the application's uncommitted `.env.local` Supabase settings at your local project, then run:

```powershell
npm run dev
```

Create a lot-tracked product, purchase it in both views, split a row, reuse a number at a different price, hold/reload a draft, queue offline/reconnect, and inspect Lot receipts and purchase details. Review future remote migration/deployment separately; nothing here pushes or deploys.
