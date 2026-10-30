# Product processes and shared purchase lot QA

For migration 056's manufacturing/accounting scenarios, also run [production costing and P&L QA](production-costing-test-cases.md).

## Setup and delivery

Work on `development`. Apply migration 054 after 052/053, then apply `supabase/migrations/055_purchase_multiple_weighings_single_lot.sql` **once** in Supabase SQL Editor. If 054 is already applied, run only 055. Execute the entire file, including its transaction and schema reload notification. Do not re-run older migrations. This change does not modify historical stock, prices, payments, sacks, lots or costing.

Existing products and older product creation/import clients default to all three processes enabled. New products also show all three checked; operators can edit any combination, including none. Purchased OR manufactured products may be manufacturing inputs, subject to actual stock availability. Manufacturing outputs require Can be Manufactured and need no existing stock. Sold-only products are not manufacturing inputs. Packaging materials follow the same input rule.

Migration 055 restores **Add weighing**: multiple weight/sack entries per product are supported, with one shared lot selector above those entries. Each weighing remains an individual immutable receipt with its own quantity, price and stock allocation; totals sum the weighings using existing per-line rounding. Auto-generation creates one lot per product per purchase. The shared lot requires the same product quality. Different products have independent lots.

Already confirmed historical multi-row/multi-lot purchases remain readable and returnable. Historical receipts are not merged. Old held or database drafts with multiple weights using the same lot are accepted. Drafts or offline tasks with conflicting product qualities or lot choices require correction; choosing a lot in the product section applies it to every weighing without changing weights or prices. Successfully confirmed requests still return the original purchase on retry, including historical requests.

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
4. **Multiple weighings, one lot:** Add a lot-tracked product in Detailed Purchase, enter 12 KG and 2 sacks, and choose `QA-ONE`. Click **Add weighing** and enter 8 KG/1 sack. Expect two editable weight rows, 20 KG/3 sacks total, one shared lot selector and unchanged unit price. Enter on the final sack field adds another weighing and focuses its weight. Removing a row updates totals. Changing the shared lot updates every remaining weighing. There is no Split into another lot action. Clicking the product in the picker again remains disabled; use Add weighing instead.
5. **Server validation:** Submit two weighings of the same product/quality to `confirm_queued_purchase_with_lots`, first with auto, then identical manual lot numbers, then the same existing lot UUID. Each succeeds with one lot and a receipt per weighing. Different locations may receive the same lot; their quantities remain location-specific. Submit different lot numbers or qualities for the same product: reject atomically with the one-quality/one-lot message. A draft may save multiple same-quality weighings, but cannot add another quality for that product. Older purchase RPCs cannot bypass required lot receipts for tracked products.
6. **Different products:** Add product A with 15 KG/`QA-A` and product B with 8 KG/`QA-B`. Confirm with valid payment. Expect two product lines, two tracked receipts, their exact quantities, distinct product/quality dimensions, and the correct stock increases in the selected locations. Supplier payable/payment and labor-session details must match the bill.
7. **Lot identity and price history:** In a later purchase reuse `QA-A` with a different price and quantity. Expect a separate immutable receipt linked to the new purchase; old receipt price unchanged. Purchase detail and Lot receipts show the correct received quantity. Inventory lot balances show current available stock. Attempt to edit confirmed lot dimensions or insert a second receipt for the same line: reject.
8. **Sacks and labor:** Use a sack-tracked product with multiple weighings, individual sack counts and an open labor session. Confirm. Verify summed stock, sack totals, purchase payments, labor link, one shared lot, and each original received quantity/cost. Retry the same request ID: no duplicate stock, sacks, receipts, lots or payments.
9. **Held/offline purchase:** Hold a two-product purchase with multiple weighings, manual prices and selected shared lots; reopen. Everything must be preserved. Queue offline, reconnect and sync; exact choices must post once. Retry a lost response with the same request ID. A queued purchase with conflicting lots must fail with a correction message and remain available for correction. Shared-lot weighings must sync normally.
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

## Initial migration 054 verification results

Run on 2026-10-30 in the development checkout:

- Passed: the ten feature test scripts in the command block above, plus `tests/purchase-detailed-view-044b.cjs` and `tests/session-access-regression.cjs`.
- Passed: `npm run build` (production compilation, TypeScript and page generation).
- Legacy `tests/sales-database.mjs` could not complete: its isolated database fixture creates only the `authenticated` role, and migration 027 requires `anon`. This is a fixture setup failure, not a passing sales test. The new process database test executes real sales confirmation for all eight process combinations and verifies reversals after flag changes.
- Standard targeted ESLint reports pre-existing `react-hooks/set-state-in-effect` errors in the existing draft/view restoration effects. Targeted ESLint with that rule disabled reports zero errors and seven existing navigation/unused-variable warnings. No claim of a clean full-repository lint run is made.
- Real Supabase/Preview browser QA has not been run; no remote migration was executed by this implementation.

## Migration 055 regression coverage

`purchase-lots-database.mjs` now confirms multiple auto/manual/existing-lot weighings, checks one lot per product and separate receipt costs/stock allocations, verifies summed sacks/labor and purchase value, and rejects conflicting lots atomically. `product-process-ui.cjs` exercises restored Add weighing callbacks and shared lot edits. `product-price-ui.cjs` verifies added weighings inherit the overridden price and selected lot. `purchase-lots-offline.cjs` round trips multiple weights per product in held/offline storage and lost-response retries. No remote migration or authenticated Preview QA is performed by these tests.
