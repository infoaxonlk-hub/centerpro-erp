# Product processes and single purchase receipt QA

## Setup and delivery

Work on `development`. Apply `supabase/migrations/054_product_process_and_single_purchase_receipt.sql` **once**, after migrations 052 and 053, in Supabase SQL Editor. Execute the entire file, including its transaction and schema reload notification. Do not re-run older migrations. Back up the target database before applying migrations using the normal project process. This change does not modify existing stock, prices, payments, sacks, lots or costing.

Existing products and older product creation/import clients default to all three processes enabled. New products also show all three checked; operators can edit any combination, including none. Purchased OR manufactured products may be manufacturing inputs, subject to actual stock availability. Manufacturing outputs require Can be Manufactured and need no existing stock. Sold-only products are not manufacturing inputs. Packaging materials follow the same input rule.

Already confirmed historical multi-row purchases remain readable and returnable. Their historical receipts are not merged. Old held or database drafts containing duplicate products must be corrected before confirmation. Remove duplicate rows and explicitly enter the correct total quantity, total sacks, unit price and single lot; do not silently merge differently priced receipts. Previously queued offline splits will be marked as needing correction by the existing sync UI. Successfully confirmed requests still return the original purchase on retry.

Use a test business with active subscription and Purchases, Sales, Inventory, Master Data and Manufacturing enabled, an authorized admin, a staff account with relevant permissions, two locations, a supplier, and another business. Use credit purchases and cash sales where helpful. Give sold-only/manufacture-only products stock through an authorized stock adjustment or manufacturing; do not enable purchasing just to seed their stock. Exercise both Purchase POS and Detailed Purchase and both sales views.

## Process combinations

For each row, create a product, save, reopen Edit, verify the checkboxes, change another product to this combination, save and reopen again. Verify prices, lot tracking and sack settings survive. Use unique product codes. Test all unchecked as well.

| Sold | Purchased | Manufactured | Sales picker | Purchase picker | Manufacturing input with stock | Manufacturing output |
| --- | --- | --- | --- | --- | --- | --- |
| No | No | No | Hidden | Hidden | Hidden | Hidden |
| Yes | No | No | Available | Hidden | Hidden | Hidden |
| No | Yes | No | Hidden | Available | Available | Hidden |
| Yes | Yes | No | Available | Available | Available | Hidden |
| No | No | Yes | Hidden | Hidden | Available | Available |
| Yes | No | Yes | Available | Hidden | Available | Available |
| No | Yes | Yes | Hidden | Available | Available | Available |
| Yes | Yes | Yes | Available | Available | Available | Available |

Sales availability still requires stock and normal sale validation. Inactive products are unavailable. Manufacturing input pickers require positive stock at the selected center/location. A product disappearing from a saved draft must not silently change its quantity, prices or lot; correct the draft when validation explains the unavailable selection.

## Detailed cases

1. **Existing product migration:** Before migration record product settings, stock, prices, an ordinary sale and purchase, and a historical split purchase if present. Apply 054. All three flags must be true, existing stock/valuation/history identical, existing sales/purchase/manufacturing still usable. Historical split receipts remain individually traceable.
2. **Manufacture-only server bypass:** Create a manufacture-only product. Confirm it is absent from both purchase and sales selectors. Using an authenticated test client's RPC calls, submit its real product/quality IDs to `confirm_queued_purchase_with_lots`, the older `confirm_queued_purchase`, and `confirm_center_sale`. Expect a cannot-be-purchased/sold error and no order, stock, payment or lot side effects. Do not use service-role credentials in the browser.
3. **Saved draft flag change:** Save a purchase draft containing an allowed product. Disable Can be Purchased in another session, then reopen/confirm. UI or database rejects it. Similarly disable Can be Sold before submitting a held sale. Disable Can be Manufactured after saving a production draft: completion must roll back, including input consumption and output lot creation.
4. **One total weighing:** Add a lot-tracked product to a purchase, enter quantity 12 KG, sacks 2 when tracked, and lot `QA-ONE`. There is no Add weighing or Split row action. Clicking the product again cannot create another row; Detailed picker disables already selected products. Edit the existing total to 15 KG; exactly one row and one lot choice remain. Enter on the final weighing field proceeds to payment, not another weighing.
5. **Same product different quality/location:** Attempt to add the same product under another quality or location. UI blocks an additional row. Submit two rows for that product directly to the purchase RPC, including different lot numbers, different quality, and different location variations. Every attempt must reject atomically with the one-lot/total-weighing message. Repeat with the older detailed/queued purchase RPC. Saving a duplicate database draft row must also fail.
6. **Different products:** Add product A with 15 KG/`QA-A` and product B with 8 KG/`QA-B`. Confirm with valid payment. Expect two product lines, two tracked receipts, their exact quantities, distinct product/quality dimensions, and the correct stock increases in the selected locations. Supplier payable/payment and labor-session details must match the bill.
7. **Lot identity and price history:** In a later purchase reuse `QA-A` with a different price and quantity. Expect a separate immutable receipt linked to the new purchase; old receipt price unchanged. Purchase detail and Lot receipts show the correct received quantity. Inventory lot balances show current available stock. Attempt to edit confirmed lot dimensions or insert a second receipt for the same line: reject.
8. **Sacks and labor:** Use a sack-tracked product in Detailed Purchase, enter one total weighing and total sack count, attach an open labor session. Confirm. Verify stock, sack totals, purchase payments and labor link. Retry the same request ID: no duplicate stock, sacks, receipts, lots or payments.
9. **Held/offline purchase:** Hold a two-product purchase with manual prices and selected lots; reopen. Everything must be preserved. Queue offline, reconnect and sync; exact choices must post once. Retry a lost response with the same request ID. A pre-change queued split must fail with a correction message and remain available for correction rather than being silently posted or discarded.
10. **Manufacturing:** Select a purchased-only input with positive stock and a manufacture-only output with no prior stock; complete milling. Then consume that manufacture-only output as an input in a second order. Both succeed with correct stock and lot balances. Sold-only input and nonmanufacturable output are rejected by both picker and `save_manufacturing_order`. Insufficient input stock or lot stock still blocks completion. Packing packaging inputs follow the same flags and stock rules.
11. **Permissions:** Remove purchase/sales/manufacturing or master-edit permissions from staff. Routes/RPCs remain blocked as before, including the new product create/edit overloads. Removing module entitlement or expiring/suspending the subscription must block corresponding operations, including super-admin business operations under existing licensing rules.
12. **Tenant isolation:** In business B try to use business A's product, quality, lot, purchase or production order UUIDs in the new and old RPCs. Expect rejection/no access. Search results contain only permitted business data. No stock/payment/receipt rows appear in either tenant from rejected requests.
13. **Returns and cancellation:** Disable a product's process flags after a successful purchase/sale. Authorized historical returns and cancellations must still reverse their original stock/lot/sack allocations. Historical multi-row purchases from before 054 must remain returnable. New transactions must obey the current flags.

## Automated verification

From VS Code PowerShell in the repository:

```powershell
git switch development
npm ci
node tests/product-process-ui.cjs
node tests/product-price-ui.cjs
node tests/purchase-lots-offline.cjs
node tests/manufacturing-ui.cjs

# PGlite is an isolated test database; it does not connect to Supabase.
$testDeps = Join-Path $env:TEMP 'centerpro-lot-tests'
npm install --prefix $testDeps --no-save @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $testDeps 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/product-process-database.mjs
node tests/purchase-lots-database.mjs
node tests/product-defaults-lot-balances.mjs
node tests/product-sacks-database.mjs
node tests/manufacturing-database.mjs
node tests/business-access-database.mjs
npm run build
```

PGlite supplies local PostgreSQL with mocked Supabase auth/storage schemas. It verifies actual migrations, RPCs, triggers and access rules, but does not replace Preview testing with real Supabase sessions. Browser/device QA and remote migrations must be performed separately by an authorized operator.

## Implementation verification results

Run on 2026-10-30 in the development checkout:

- Passed: the ten feature test scripts in the command block above, plus `tests/purchase-detailed-view-044b.cjs` and `tests/session-access-regression.cjs`.
- Passed: `npm run build` (production compilation, TypeScript and page generation).
- Legacy `tests/sales-database.mjs` could not complete: its isolated database fixture creates only the `authenticated` role, and migration 027 requires `anon`. This is a fixture setup failure, not a passing sales test. The new process database test executes real sales confirmation for all eight process combinations and verifies reversals after flag changes.
- Standard targeted ESLint reports pre-existing `react-hooks/set-state-in-effect` errors in the existing draft/view restoration effects. Targeted ESLint with that rule disabled reports zero errors and seven existing navigation/unused-variable warnings. No claim of a clean full-repository lint run is made.
- Real Supabase/Preview browser QA has not been run; no remote migration was executed by this implementation.
