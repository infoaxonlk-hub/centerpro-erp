# Product defaults and physical lot balances

Implemented on `development`. No push, deployment or remote database migration is part of this change.

## Behavior

- Product create/edit exposes default purchase prices (the existing quality `default_price` field), default sales price, Track Purchase Lots, and a clearly labelled future FIFO/AVCO policy. Quality prices remain individually editable. Defaults never revalue inventory or update receipt/sale history.
- Purchase POS and Detailed Purchase initialize new rows from the latest confirmed purchase in the same business/product/quality. Ordering is `confirmed_at DESC, purchase ID DESC, entry_order DESC, line ID DESC`. Drafts, cancelled purchases and failed transactions do not supply prices. With no confirmed purchase, the quality's default purchase price is used. Center purchase price overrides remain stored for compatibility, but no longer choose the initial entered purchase price; existing server system-price/override calculations are preserved.
- Manual prices, existing-lot selections, weight rows, held drafts and queued purchase retries keep their saved prices. Confirmed-price snapshots are cached separately per business and user. While offline, the most recently cached confirmed price is used, falling back to the product/quality default; the device cannot know about confirmations it has not downloaded. Refreshing prices updates future rows only.
- An explicit product default sales price takes precedence over the existing remembered center/quality selling price. Existing products receive NULL, preserving remembered prices until a default is configured. Blank retains this compatibility behavior. Existing sales validation, manual overrides, drafts and offline payloads continue unchanged. Zero is an explicit default and still requires a permitted positive price before checkout under the existing sale rules.
- Stock explorer keeps product totals and adds searchable Lot / Batch stock cards. Product, quality, location, center and text filters apply to lot cards. Cards label quantities as **Current available quantity**. Product summary metrics continue to show totals across all lots; lot quantities are not used to imply lot accounting costs or sack allocations.

## Costing status

**The selectable FIFO/AVCO valuation engine is pending.** The configuration is persisted and visibly labelled as not applied. Existing movement-value average calculations and historical sale costs are unchanged. Physical oldest-received-lot allocation is independent of valuation. There is no active per-product valuation policy to migrate in this change; an engine must introduce a safe policy activation/migration before these settings can affect valuation.

## Physical allocation and historical limits

- Migration 051 adds one physical allocation ledger beside existing stock movements. It does not duplicate purchase lots or immutable receipt records.
- Every pre-migration stock movement receives an unassigned allocation with its existing signed quantity. This intentionally includes receipts created by Phase 1: outbound history did not identify lots, so their current remaining quantities cannot safely be reconstructed. Original receipt history remains available under Purchases → Lot receipts, labelled as original received quantities.
- New tracked purchases attach immutable receipts to matching purchase movements within the purchase confirmation transaction. Reused lot numbers retain separate receipt costs and quantities.
- New outbound sales, transfers, scrap and downward adjustments consume Unassigned / Legacy stock first, then lots ordered by original earliest receipt timestamp and lot ID. Transfers preserve the exact source allocation at their destination. Positive adjustments and non-lot purchases remain unassigned.
- Sales returns restore the original sale-line allocations. Purchase returns remove the original purchase-line lots and fail if those lots are no longer available, rather than returning unrelated lots. Cancellation reverses recorded original allocations. Historical unallocated sources reverse into/from unassigned stock. Existing return/cancellation validation remains in force.
- Allocations reconcile to every original stock movement. Per-dimension transaction locks, existing request IDs, transaction rollback and immutable stock postings protect concurrency and retries. Failed confirmations roll back purchases, receipts, allocations and existing payment/sack/labor effects together.
- Read RPCs enforce business, role, module, subscription and center access. Latest-price lookup deliberately spans the business's centers, as required; stock balances remain center-scoped. Clients cannot directly write allocation rows.

## Exact VS Code PowerShell checks

```powershell
Set-Location 'D:\Infoaxon\Project\centerpro-erp'
git switch development
npm ci

# Isolated embedded PostgreSQL test dependency, outside the project.
$lotTestRoot = Join-Path $env:TEMP 'centerpro-lot-tests'
npm install --prefix $lotTestRoot --no-save --package-lock=false @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $lotTestRoot 'node_modules/@electric-sql/pglite/dist/index.js'

node tests/product-defaults-lot-balances.mjs
node tests/product-price-ui.cjs
node tests/purchase-lots-database.mjs
node tests/purchase-lots-offline.cjs
node tests/product-sacks-database.mjs
node tests/business-access-database.mjs
node tests/purchase-pos-044.cjs
node tests/purchase-detailed-view-044b.cjs
node tests/sales-parity-046.cjs
node tests/navigation-regression.cjs
npx eslint lib/product-price-defaults.ts lib/stock-lot-balances.ts lib/use-purchase-price-defaults.ts app/dashboard/purchases/new/page.tsx app/dashboard/stock/page.tsx
npm run build
```

These database tests apply migrations to temporary PGlite databases, not your Supabase project.

## SQL migration steps (operator-run)

1. Confirm migrations through `050_purchase_lots.sql` are already applied. Apply **only the next file**, `supabase/migrations/051_product_defaults_and_lot_balances.sql`, once, before using this application version. Do not rerun 050 or paste a duplicate migration.
2. Open the full 051 file in VS Code. For local validation, paste it into your **local Supabase Studio SQL Editor** and run the complete transaction. This migration takes a stock-write lock while creating the baseline; run it when stock posting is idle. If it fails, its transaction rolls back; fix the error before proceeding.
3. After the successful transaction, run:

```sql
notify pgrst, 'reload schema';

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'products'
  and column_name in ('default_sales_price', 'costing_method', 'tracks_purchase_lots');

select to_regclass('public.stock_lot_allocations');
select to_regprocedure('public.latest_purchase_prices()'),
       to_regprocedure('public.stock_lot_balances()');

-- Must return zero: each allocation total equals the original movement quantity.
select count(*) as unreconciled_movements
from (
  select m.id
  from public.stock_movements m
  left join public.stock_lot_allocations a on a.movement_id = m.id
  group by m.id
  having coalesce(sum(a.quantity), 0) <>
    case when m.movement_type in ('purchase_in', 'transfer_in', 'adjustment_in')
      then m.quantity else -m.quantity end
) discrepancies;
```

If using a local Supabase instance and `psql` is installed, the file can instead be applied with:

```powershell
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -f 'supabase/migrations/051_product_defaults_and_lot_balances.sql'
```

After your local environment points to that migrated database:

```powershell
npm run dev
```

Verify product creation/editing, a purchase followed by another purchase of the same quality, an overridden held draft, offline retry, a sale/return, and a stock transfer using the new lot filter. A remote database migration and Vercel Preview/production promotion remain separate operator actions; none are executed here.
