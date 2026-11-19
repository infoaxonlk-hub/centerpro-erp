# Automatic FIFO for BoM Milling Orders

Milling raw-material components are submitted as `source_selection: 'auto'` and
`lot_id: null`. Packing retains explicit source selection for tracked components.
Existing manually selected records remain valid; completed records are immutable.
Opening and saving an existing Milling draft opts its raw components into automatic
selection. Merely opening it does not write to the database.

## Database change

`065_milling_fifo_auto_consumption.sql` changes two effective functions, using
guarded definition replacements consistent with the existing migrations:

- `prepare_bom_completion`: the tracked-component manual-source requirement now
  applies to Packing, while all other checks remain intact.
- `complete_manufacturing_order`: BoM Milling inputs execute in immutable snapshot
  component-array order. Packing and legacy orders retain their existing order.

No tables, historical records, Purchase Order behavior, shared allocator, valuation
triggers, permissions, or stock locks change. There is no backfill. Apply the new
migration to an isolated development database before exercising the new UI.
Do not apply it to production as part of this task.

## Allocation and audit

The preview and completion use Legacy first, then the earlier of lot creation and
earliest purchase receipt, with lot UUID as the tie-breaker. The preview compares
timestamp instants (including offsets and microseconds), shares remaining balances
across component rows, and uses remaining average value within each lot.

The preview is an estimate, not a reservation. Completion rechecks current stock
under existing transaction locks. The completed cost-entry snapshots are the
authoritative record of consumed lots, quantities and exact six-decimal values.
The detail page resolves lot numbers even for exhausted lots using tenant-scoped
reads; an unavailable name falls back to its recorded lot UUID.

Conversion costs, expense capitalization, output shares, by-products, sack posting
and sales COGS retain their existing implementation. There is no new cancellation
workflow: regression tests verify that cancelled drafts cannot complete and that
completed records cannot be changed to cancelled.

## Automated verification

Run from the repository root:

```powershell
node tests/production-cost-preview.cjs
node tests/manufacturing-bom-ui.cjs
node tests/manufacturing-bom-plans.cjs
node tests/manufacturing-ui.cjs
node tests/purchase-lots-offline.cjs
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

Database tests create their own isolated schemas and fixtures; they do not use
application environment database URLs. Set `PGLITE_MODULE` to the absolute path of
an installed `@electric-sql/pglite/dist/index.js`, then run:

```powershell
node tests/manufacturing-bom-database.mjs
node tests/manufacturing-database.mjs
node tests/production-costing-database.mjs
node tests/purchase-lots-database.mjs
```

For real multi-connection concurrency checks, set `EMBEDDED_POSTGRES_MODULE` to the
absolute path of `embedded-postgres/dist/index.js` and run
`node tests/manufacturing-bom-database.mjs`. This mode takes precedence over
PGlite and starts its own temporary PostgreSQL cluster bound to `127.0.0.1` on an
available port. It accepts no remote connection string. Test dependencies can be
installed outside the repository; no package changes are required. Temporary
cluster data is retained for inspection, and the server is stopped on completion.

The PostgreSQL mode verifies actual lock waiting for concurrent completion of one
order and for different orders competing for insufficient stock. The losing
transaction leaves no stock movements or cost entries. PGlite alone cannot prove
multi-connection lock behavior.

## Manual QA on an isolated development database

1. Apply migration 065. Create two eligible raw-material lots at different costs,
   with 100 kg in the older lot and 200 kg in the newer lot.
2. Load a Milling BoM and enter 150 kg actual consumption. Verify that no raw
   material lot selector is required, and the preview shows 100 kg + 50 kg.
3. Save and reopen the draft. Verify quantities and component order are retained,
   and stock/cost ledgers have no new postings.
4. Complete and verify the detail page shows the exact consumed lot numbers,
   quantities and six-decimal values. Check exhausted lots remain named.
5. Reconcile input costs with consumed allocation values, then reconcile total
   production cost with finished-product and by-product costs, including labor.
6. Repeat with Legacy stock, repeated raw components and a reused purchase lot.
   Verify Legacy is consumed first and reused-lot value follows its remaining
   weighted average.
7. Enter more than total eligible stock; verify failure creates no partial stock
   consumption, output lots or cost entries. Stock in another location must not
   satisfy the shortage.
8. Complete the same order in two sessions; verify one posting. Complete competing
   orders where both cannot be fulfilled; verify one succeeds and one fails cleanly.
9. Verify a second tenant cannot inspect or complete the order. Check a historical
   manual-lot completed order remains unchanged and readable.
10. Verify tracked Packing still requires its actual source. Exercise Purchase
    auto/manual/existing-lot receipts and confirm their creation behavior is unchanged.

Manual browser QA requires an isolated application/database setup and is separate
from the automated component and database checks.

## Local validation results

- All nine regression scripts listed above passed. The BoM database suite passed
  in both PGlite and real PostgreSQL modes, including actual lock-wait assertions.
- TypeScript (`--noEmit --incremental false`) and the production build passed.
- Focused lint passed for all changed application files and the database test.
- Full repository lint failed with 208 errors and 22 warnings. Comparing each
  modified source/test file against HEAD produced identical lint findings: no new
  findings, including the existing CommonJS test import errors.
- Manual browser QA has not been performed. No production Supabase connection,
  deployment, commit, push or merge was performed.
