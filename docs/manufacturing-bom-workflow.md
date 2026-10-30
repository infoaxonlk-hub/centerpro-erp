# Manufacturing BoMs and actual orders (057)

This adds the planning workflow before the existing production-costing completion flow. It retains **056**, its exact lot valuation, expense capitalization, sales COGS and management P&L. Apply 057 after 056; do not revert, reorder or re-run applied migrations. No duplicate accounting or stock engine is introduced.

## Workflow reference

Reviewed official Odoo documentation for [BoM configuration](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/bill_configuration.html), [one-step manufacturing](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/one_step_manufacturing.html), [planned/actual costs](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/mo_costs.html), [by-products](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/workflows/byproducts.html) and [source/destination routing](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/use_routes.html). These inform the product → plan → actual consumption → output workflow. CenterPro retains its own tenant, stock-center, location and quality model rather than implementing Odoo's work-center scheduling or accounting.

## Configure and use a BoM

Manufacturing → Recipes / BoM now configures finished product/quality, baseline output quantity and stock unit, components, operations and by-products. Existing `manufacturing_recipes` is the header; only its missing component/by-product/operation children are added. Existing operation-only presets remain identifiable and can be converted by filling the missing plan. Existing manual orders retain their legacy workflow.

A BoM has one component source center/location. Stage raw material and packaging there using existing stock transfers. Finished goods and each by-product can have independent active destinations in other permitted centers of the same business. Selectors use only active locations belonging to the selected center; the server independently validates ownership, activity and center access. Read policies prevent a multi-center BoM being exposed as a partial plan to a user lacking destination access.

No source lot is stored in a BoM. Components use their stock units and must allow purchasing or manufacturing; outputs must allow manufacturing. Planned operations support hours, batch/labor quantities and per-input-KG rates. KG/G weight normalization is explicit. Output cost shares total 100%, or all remain zero for the existing proportional accepted-output allocation.

The default New milling/packing screen selects a finished product and matching active BoM. **Load / replace BoM plan** scales components, by-products and operation quantities by target quantity / baseline quantity. Actuals appear beside planned values. Loading a replacement is explicit and confirms replacement; rerenders and selector edits do not silently overwrite entered actuals.

Each draft stores its BoM revision snapshot. Editing or archiving the reusable BoM does not change that draft's loaded plans, rates or destinations. Reload a newer revision explicitly. The server rejects stale new-plan revisions, attempted product/destination/rate overrides and legacy-save attempts against structured orders.

Record actual consumed quantity and source for each component. Tracked components require an actual lot or explicit Unassigned / Legacy selection before completion. Untracked components may use the existing oldest-lot allocation. Available choices follow source center/location, product and quality. There is no independent inactive-lot flag in the existing registry: usability is determined by stock availability and active products, qualities and locations.

Record actual hours or batch/labor quantities per operation. Per-KG consumption is derived from actual weight. Configured rates come from the snapshot; they are not client overrides. Existing labor/service expenses can replace corresponding conversion charges once, preserving 056's expense reclassification. Operation rows retain rate-derived and final capitalized cost when one recorded expense funds multiple operations.

Actual accepted finished/by-product quantities determine receipts. A zero actual by-product remains in the audit without a zero-quantity receipt; positive allocated share requires positive accepted quantity. Packing uses explicit rice and packaging components, so packaging is not automatically duplicated from output counts. Only one rice variety is allowed. Actual rice may exceed accepted packed weight, recording the difference as `process_loss_kg`; it cannot be less. Legacy manual packing equality is unchanged.

Drafts neither reserve nor post stock/accounting. Completion locks all centers in stable order, rechecks source availability, locations and master data, then atomically posts actual components, outputs, sacks, lot links and costs through the existing 056 transaction. Retries reuse the same order ID. Completed orders and operation/cost snapshots remain immutable. Earlier completed orders are not revalued or assigned invented plans.

## Boundaries

- One shared component source location per BoM; stage materials from other locations using existing transfers. Each component row selects one source lot; repeated material rows may represent separate planned sources.
- One finished product plus milling by-products. Packing by-products are outside this rice-packing flow.
- No multi-level explosion, reservations, scheduling, work-order timer or offline manufacturing queue. Existing purchase/sales offline flows are unchanged.
- Stock quantities have three decimals; operation quantities/costs support six, including G-to-KG conversion. Each BoM section supports up to 200 rows to avoid silent nested-query truncation.
- The [056 accounting boundary](production-costing-and-profit-loss.md) still applies: valuation subledger and management P&L, not a statutory general ledger.

## Setup and verification commands

With 056 already applied, run the **entire** `supabase/migrations/057_manufacturing_boms_and_planned_orders.sql` once in Supabase SQL Editor. It runs transactionally and reloads PostgREST. No remote migration, push, merge or deployment is performed by this implementation.

```powershell
git switch development
npm ci
$testDeps = Join-Path $env:TEMP 'centerpro-lot-tests'
npm install --prefix $testDeps --no-save @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $testDeps 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/manufacturing-bom-database.mjs
node tests/manufacturing-bom-plans.cjs
node tests/manufacturing-bom-ui.cjs
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
node tests/purchase-detailed-view-044b.cjs
node tests/session-access-regression.cjs
npm run build
```

Database tests use isolated PGlite with auth/storage fixtures. UI tests exercise real handlers through the existing hook harness; they do not claim authenticated Preview/browser coverage. Run [manual QA](qa/manufacturing-bom-and-order-test-cases.md) with real authorized sessions after migration.

## Verified results

All 17 test scripts listed above passed during implementation. The BoM database/UI and legacy manufacturing UI checks were rerun after the final legacy-draft compatibility correction and passed. The production build passed with TypeScript validation and 58 generated pages. Targeted ESLint passed with the existing `react-hooks/set-state-in-effect` rule excluded. No remote migration, authenticated browser/Preview test, push, deployment or merge was performed.
