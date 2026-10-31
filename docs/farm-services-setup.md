# Farm Services setup and QA

Initially implemented on **developemnt-farmermodule**, the existing remote branch spelling explicitly selected by the user, starting at `0bd1fea` (migration 055). The user subsequently authorized production integration: main's BoM, production costing and Tamil receipt changes are retained alongside Farm Services. No migration was executed against a remote database by the coding agent.

## Database setup

Farm Services uses **supabase/migrations/058_farm_services.sql**. The subsequent **059_platform_module_save_repair.sql** repairs platform module persistence and administrator permission grants; see [platform access repair](platform-access-repair.md). Apply the entire file once after the existing migrations on the target database. It is transactional and reloads PostgREST. Do not edit or rerun previously applied files.

Numbers 056 and 057 are already used on main for production valuation/BoMs. They are intentionally not reused by this branch. A database at this branch's 055 can apply 058 directly. A database already at main's 057 applies 058 after 057; do not roll back or rerun 056/057. Both baselines were exercised in isolated PostgreSQL tests. The production integration retains main's newer application features as well as Farm Services.

Migration 058:

- Registers independent optional `farm_services`, without enabling unrelated Sales, Cash or Inventory screens or automatically enabling it for existing businesses.
- Adds `products.product_type` (`stock` default, `service`) and service constraints. Stock/Service type cannot be converted in place. Existing products remain Stock Items with unchanged prices/flags/history. Service units are Acre or Hour; default rate reuses `default_sales_price`.
- Adds organization-scoped `farm_seasons`, with a single active default and archival.
- Extends existing `sales_orders` with a source discriminator and immutable-at-confirmation service/season/location/subtotal/adjustment snapshots. Reuses existing `sales_order_lines`, `sales_invoices`, `customer_receivables`, `sales_payments`, `sales_credit_settlements`, cash and bank posting triggers. No second farmer debt or revenue ledger.
- Allows no physical location for a service sales line. Guards reject service products in purchase, stock movement, lot, sack, scrap, transfer, adjustment and manufacturing tables. Historical line descriptions, units, quantities and rates remain snapshots.
- Adds `farm_collection_requests` solely for collection idempotency, not as a financial ledger. Applies tenant, business/subscription/module and center access, revokes raw writes, audits operations, and keeps internal customer/payment helpers private.
- Adds optional `organizations.receipt_logo_url` and an atomic existing company-profile wrapper. No branding/contact data is invented.

## Enablement and permissions

1. As Super Admin, open Businesses / Manage modules and enable **Farm Services** for the selected business. Keep its subscription operational.
2. Explicitly grant the selected business admin access for enabled modules using the existing platform action. Provisioning/permission grant includes the new keys. Merely changing entitlements still does not silently broaden staff access.
3. In Users & Access, grant staff **Farm Services** (`farm_services`) and their permitted centers. Grant **Manage service products** (`farm_services_manage`) only to staff who should create/edit services. Service management requires Farm Services plus admin or this additional permission. All Farm Services billing operators may enter an order-specific rate, consistent with existing seller-entered sales prices.
4. Normal Sales screens continue to require Sales. Farm Services has scoped shared-customer/invoice collection access and never grants a broad Sales permission as a workaround. Farm-only users see shared receivables, but not normal sales line/order details.
5. Billing/collections RPCs independently check module, subscription, role, organization and center. Direct URLs are guarded by the Farm layout and page. Supabase RLS and RPC validation also enforce those boundaries.

## Configure and use

- Users / Company profile: configure actual business name/contact details and optional HTTPS or local image URL for the receipt logo. Existing Users access is required; Farm access does not grant company settings access.
- Farm Services / Service Products: create Ploughing, Harvesting, Tractor hire, etc. Choose Acre or Hour, default selling rate and active status. Management also provides editing/archival. The product master identifies Stock Items and directs service creation/editing to the Farm service manager.
- Seasons: add Maha 2026/27, Yala 2027, etc.; choose an active default and archive old seasons. Archived seasons stay in historical filters and saved bills. Archiving a default requires clearing default first.
- New Bill: choose center if needed (the permitted default is preselected), search/select an existing customer, select season and service, optionally enter field/village, then quantity/rate. Customer/season `+` dialogs preserve the order and select the created record.
- Charges/deductions are fixed monetary amounts with descriptions. Quantity has up to 3 decimals; money/rate has up to 2. The server rounds the subtotal and computes the final total itself. Client preview uses integer arithmetic with matching positive-number rounding. Existing zero-total/zero-subtotal bills remain disallowed; a service default rate of zero must be overridden to a positive bill rate.
- Cash/Bank pay the full bill; Credit can include an optional initial Cash/Bank payment. Bank requires an active account belonging to this business. Collections cannot exceed the remaining invoice balance. Credit without initial payment creates no cash/bank receipt.
- Save & Print confirms atomically, then opens the saved receipt. Select English, Sinhala or **Tamil** before saving or on the receipt. Fonts are self-hosted under `public/fonts` with SIL Open Font License files. Printing waits for selected fonts and configured logo decoding. The receipt uses 80mm print CSS and labels **this bill's outstanding** separately from any customer account total. Canceling the OS print dialog does not undo/delete the bill; Reprint never creates a sale.
- Draft fields/retry identity are session-scoped by organization and user. Appropriate center/season/service preferences are remembered locally without retaining another business's values. A submitted request ID is also placed in the URL: refreshing after an uncertain response recovers the saved bill from the server. Unknown outcomes lock entries; Retry reuses the same request. Browser storage restrictions can prevent restoring unsaved form fields, but the URL retains the submitted request identity.
- Service Orders: search and filter by customer, season, service, date and status; mobile cards, desktop table and 25-row pages. Server reads are paginated so totals do not silently truncate at a Supabase row limit.
- Customer Accounts: uses the existing credit-ledger UI and actual shared invoices/receivables, including normal stock credit sales. Customer and order-source filters distinguish accounts/bills. A farm-only user can collect shared invoices without opening unrelated Sales screens. Normal stock bill references remain plain references for such users. Normal Customer Receivables and Sales reports also distinguish Farm Services; each bill/payment is counted once. Item-wise Farm sales use the net bill total; actual-price lines retain their original subtotal.
- Cancellation: existing request/admin-review workflow is reused inside Farm receipts. Credit-only and original Cash bills reverse through existing logic without adding stock. Existing policy still blocks cancellation after later credit collections or for non-cash payments, requiring manual refund/reconciliation. No second reversal engine or invented bank journal is introduced.

## Test setup and commands (PowerShell)

Do not point tests at a business/production database. Database tests use an **explicitly configured, isolated in-memory PGlite test database**, never Supabase credentials. Browser tests use a local fixture server with actual React component markup and CSS; they do not exercise authenticated Supabase browser sessions.

```powershell
git switch developemnt-farmermodule
npm ci
$testDeps = Join-Path $env:TEMP 'centerpro-lot-tests'
npm install --prefix $testDeps --no-save @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $testDeps 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/farm-services-database.mjs
node tests/farm-services-ui.cjs
node tests/manufacturing-database.mjs
node tests/product-process-database.mjs
node tests/product-defaults-lot-balances.mjs
node tests/product-sacks-database.mjs
node tests/purchase-lots-database.mjs
node tests/business-access-database.mjs
node tests/business-admin-access-database.mjs
node tests/product-process-ui.cjs
node tests/product-price-ui.cjs
node tests/manufacturing-ui.cjs
node tests/sales-receipt-047.cjs
node tests/business-access-navigation.mjs
node tests/purchase-lots-offline.cjs
node tests/purchase-detailed-view-044b.cjs

# Optional compatibility run, reading main's 056/057 migrations without merging:
$env:FARM_TEST_MAIN_BASELINE = '1'
node tests/farm-services-database.mjs
Remove-Item Env:FARM_TEST_MAIN_BASELINE

$browserDeps = Join-Path $env:TEMP 'centerpro-farm-browser'
npm install --prefix $browserDeps --no-save playwright-core
$env:PLAYWRIGHT_MODULE = Join-Path $browserDeps 'node_modules/playwright-core'
$env:FARM_LAYOUT_HTML = Join-Path $browserDeps 'farm-form.html'
# Set CHROME_PATH if Chrome/Edge is not at the default Windows locations.
node tests/farm-services-ui.cjs
node tests/farm-services-mobile.cjs

node node_modules/eslint/bin/eslint.js app/dashboard/farm-services lib/farm-services.ts lib/access.ts lib/business-modules.ts components/credit-ledger.tsx app/dashboard/users/company-profile.tsx app/dashboard/masters/masters-manager.tsx app/api/admin/users/route.ts --rule 'react-hooks/set-state-in-effect: off'
npm run build
```

Screenshots and English/Sinhala/Tamil receipt PDFs from the browser fixture are written next to `FARM_LAYOUT_HTML` in the temporary test directory, not into the repository.

## Manual QA and expected results

| Case | Steps | Expected |
|---|---|---|
| Enablement | Enable only Dashboard/Farm Services; grant farm permission and center | All five Farm navigation screens work; Sales remains restricted |
| No access | Disable Farm, remove permission, expire subscription, suspend business, or request an unassigned center in turn | Direct route/RPC/table access rejected; no financial writes |
| Tenant isolation | Use another business's customer/service/season/center/bank IDs; inspect rows while logged into the first | References rejected and foreign rows hidden |
| Stock compatibility | Before migration note stock prices/quantities/customer balances; apply 058 | Existing records remain Stock Items; no changed balances/history |
| Service master | Create/edit Acre and Hour services; archive one | Defaults editable; only active services appear on new bills; saved rates/units do not change |
| Physical protection | Try a service ID in purchase, lot, stock adjustment/transfer/scrap or manufacturing RPC | Transaction rejected; service creates no physical movement/lot/sack/COGS |
| Normal stock sale | Sell a stocked product normally | Stock/lot/sack/cost behavior unchanged |
| Season default | Set Maha default, choose Yala default, archive Maha | One active default; archived season hidden for new bills, visible historically |
| Customer quick create | Enter quantity/rate; open + Customer; fail validation then save name/optional phone/address | Draft preserved through failure/close; new existing-customer record auto-selected |
| Season quick create | Open season + while a bill is half entered, then save | Order preserved; new season auto-selected |
| Acre bill | Enter 2.5 acres at 12,000 | Subtotal/total 30,000 on preview, database, receipt and shared report |
| Hour bill | Enter 1.125 hours at 3,500, charge 100, deduction 37.50 | Total 4,000; each description/effect visible |
| Rounding | Enter 1.005 units at rate 1 | Preview/server subtotal 1.01 |
| Invalid totals | Bypass UI with NaN/Infinity, quantity 0, negative rate/adjustment, >3 quantity decimals, negative/zero final total | Rejected; no partial sale/payment |
| Shared credit | Create separate ploughing/harvesting credit bills for the same customer; also create a normal stock credit sale | Three existing invoices, one summed customer receivables account; no duplicate revenue |
| Credit | Save a credit bill with zero initial paid | Outstanding equals total; no cash/bank posting |
| Initial partial | Credit total 30,000; initially collect 5,000 cash or bank | Paid 5,000, this bill due 25,000; actual payment method recorded |
| Later partial | Collect 10,000 against that shared invoice | Due 15,000 in invoice, receivable and order; one cash/bank posting |
| Overpayment | Initial/later amount exceeds due, or initial method is Credit | Rejected; due/payment allocation unchanged |
| Duplicate retry | Double tap Save, disconnect during response, refresh submitted URL, retry same request | Same saved order/payment; no second bill; reprint works |
| Collection retry | Retry the same collection request ID | No duplicate sales payment/cash/bank entry |
| Rate overrides | Override one order rate; edit product default later | Historical quantity/rate/unit/description unchanged |
| Cancellation | Cancel a credit-only bill and a cash bill via request/admin review | Receivable voided; cash reversal once; no inventory/COGS posting |
| Restricted refund | Attempt cancellation after a later collection or a bank payment | Existing manual-reconciliation policy blocks it clearly |
| Reports | Compare all-sales, stock-only and Farm-only filters; compare receivables | Sum of source types equals all; customer balance includes each outstanding bill once |
| Mobile | Use 360px and 390px phones; expand adjustments and open quick dialogs | Readable, no horizontal page scroll, large payment/save targets |
| Receipt languages | Save/print/reprint English, Sinhala and Tamil; use long service/customer names | Correct captions, units, adjustments, actual paid/due; loaded local fonts; no clipped 80mm text |
| Print failure | Cancel print, refresh saved receipt, block printer, reprint | Bill remains saved; no duplicate order/payment |
| Branding | Configure actual company contacts and optional logo; remove optional fields | Actual configured values only; absent fields omitted |

## Verification boundary

All 17 distinct test scripts above passed during implementation, including the local Chromium test. The Farm database suite also passed with main's 056/057 migrations loaded in the isolated test database. Focused ESLint passed (the session-draft hydration flow uses the documented `react-hooks/set-state-in-effect: off` check override); the production build passed with TypeScript validation and 62 generated pages.

Automated local database, handler/rendering, navigation, compatibility and Chromium layout/print checks are recorded in the handoff. Physical thermal-printer output and real authenticated Supabase/Preview sessions must still be tested after the migration is applied by the user. Farm bills can now be queued offline as described below; server confirmation still requires a connection. Existing purchase/sales offline flows remain unchanged. No full general ledger, new debt ledger or stock revaluation engine is introduced.


Offline Farm billing: open New Bill online once and allow its assets to finish downloading, then use /offline/farm-services on the same device/account. Cached selections expire after 8 hours; reconnect to refresh. Existing customers/services are supported offline; creating them requires a connection. Orders remain pending in IndexedDB until server permission/module validation succeeds. Keep the screen open after reconnecting to sync and open recently synced receipts. Original request IDs prevent duplicate confirmation on retries. No private dashboard HTML is cached. Test offline saving, reload, reconnect/sync, rejected bill correction, switched-account isolation and receipt printing in Preview. No SQL migration is required for these UI/offline changes.


Offline receipt update: Confirm & Print Bill durably saves the same request and a receipt snapshot on this device, then opens the normal printable receipt. Offline receipts use a unique LOCAL reference and a small offline label; the server assigns the official bill number on synchronization. Cash/bank/receivable postings still happen only when the server accepts the queued bill. New bill opens a fresh entry without waiting for sync. Saved bills is collapsed by default and supports reprinting pending local receipts after reopening. Business receipt contact details are cached from the authorized online New Bill page. Open that page online once after updating.

QA: disconnect, enter cash/bank/credit bills, Confirm & Print, verify quantity/adjustments/paid/due and selected language; New bill must clear quantity and get a new request ID. Reload while offline and reprint under Saved bills. Reconnect and confirm exactly one official bill/payment for each request; verify rejected bills remain recoverable. Verify New bill from an online receipt and smaller buttons at 360px/390px. Physical printer and authenticated Preview sync remain manual integration checks.
