# Unified customer and supplier records

Local refactor on `development-trade-accounting`. No commits, pushes, deployments or remote migrations performed.

Customer and supplier lists now open one record with an Odoo-inspired header (display name, optional Individual/Company classification, phone, email and existing primary contact address). General, Addresses, Tax & Payment and Transactions tabs retain one draft. Existing basic fields and every Phase 1A field save together. Edit is explicit; Save exits edit mode only after successful readback; Cancel restores the loaded record. Stale-save errors retain the draft. Record/list navigation and links prompt before discarding edits; browser unload and back navigation have guards. Tabs do not discard fields. A server-confirmed identity is retained if readback fails, avoiding a second create on retry.

## Entry points and old links

- Customers: `/dashboard/sales/customers?id=<customer UUID>`.
- Suppliers: `/dashboard/purchases/suppliers?id=<supplier UUID>`.
- Masters-only supplier access: `/dashboard/masters?tab=suppliers&id=<supplier UUID>`.
- Services customers: `/dashboard/farm-services/customers?id=<customer UUID>`.
- Old customer/supplier `legal` routes and customer `manage` route redirect to the corresponding unified list, preserving valid `id`, `partyId`, `customerId` or `supplierId` query references where available.
- The separate “Legal details and addresses” link is removed from customer/supplier entrypoints. Business profile remains under Users; its link now identifies the business profile.

The Transactions tab reuses existing purchase orders/sales orders, invoice/payable outstanding amounts and payment screens. It creates no balances. Services-only users retain shared customer invoice dues even when stock order detail access is denied; those invoices display references without restricted order links. Supplier/customer IDs, center scope and original transaction snapshots remain unchanged.

Full editing retains the Phase 1A administrator/module/center checks. Ordinary operators retain name/phone/address-only quick creation through the existing Sales/Services customer RPCs and supplier insert policy; optional legal fields do not become requirements. Existing POS and Services quick dialogs remain unchanged.

## Why migration 062 is necessary

### Recovery: column already exists (42701)

If running 062 in SQL Editor reports `customers.party_classification already exists`, do not delete the column or its values. The error establishes that the column exists; it does not establish that the rest of 062 is installed. After 061, run the complete **063_unified_party_master_repair.sql** instead of retrying 062. It handles missing/existing columns, reinstalls the unified RPCs and own guards, and preserves existing party data. It is also safe after a fully installed 062 and on repeat execution. If a previous failed manual transaction remains open, run `ROLLBACK;` in that SQL Editor session first, then execute the complete 063 file.

063 validates existing column types and classification values before installing its checks. It stops without rewriting incompatible data. Report that specific error for inspection rather than deleting/reclassifying values. Local PGlite tests passed for partial installation, repeat installation, preserved rows, unique guards/RPCs and incompatible-data rejection. Normal fresh migration replay through 063 is also tested. No remote database repair was performed by the agent.

Apply locally in sequence **060 → 061 → 062_unified_party_masters.sql**, with the complete preceding migration history. Do not edit or rerun historical migrations. Nothing has been applied remotely.

The existing schema has no persistent Individual/Company classification, and the Phase 1A save RPC cannot save phone, primary contact address or legacy supplier fields. Migration 062 adds **only a nullable `party_classification` column to customers and suppliers**, with `individual`/`company` checks and an edit guard. Existing records stay unspecified; no VAT status is inferred or changed. There are no new party records/tables.

`read_party_master` wraps the permission-checked `read_legal_master`, adding existing basic data for the same ID. `save_party_master` wraps **the existing `save_legal_master` in the same database transaction**, retaining its revisions, permissions, validation, address defaults, VAT dates and audit. Basic changes are rolled back if any validation fails. Basic changes increment the revision so stale forms are detected. Audit additions record metadata, not bank details or address/tax values. Supplier bank details/notes remain outside legal snapshots. RPC privileges exclude anonymous/public execution; tenant and center access is inherited from 061 and existing typed records/RLS. No stock, valuation, accounting, payment, tax calculation or historical-document posting code is changed.

## Checks and local setup

Use the existing temporary PGlite/Playwright dependencies or install them into a temporary directory outside this repository. Tests do not connect to hosted Supabase.

```powershell
$env:PGLITE_MODULE = Join-Path $env:TEMP 'centerpro-lot-tests/node_modules/@electric-sql/pglite/dist/index.js'
node tests/legal-masters-database.mjs
node tests/farm-services-database.mjs
node tests/purchase-lots-database.mjs
node tests/unified-party-ui.cjs
$env:PARTY_LAYOUT_DIR = Join-Path $env:TEMP 'centerpro-unified-party-layout'
$env:PLAYWRIGHT_MODULE = Join-Path $env:TEMP 'centerpro-farm-browser/node_modules/playwright-core'
node tests/unified-party-ui.cjs
node tests/unified-party-mobile.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
```

Automated coverage: migration replay with existing records/nonzero dues; atomic basic/legal editing; classification independent of VAT; invalid classification rollback; cross-tenant/center/role/module restrictions; snapshot privacy; UI Edit/Save/Cancel; draft retention across tabs; navigation confirmation; stale-save recovery; existing transaction dues; legacy redirect IDs; EN/SI/TA catalogs. Local Chromium fixtures cover customer and supplier, all four tabs and three languages at 360px, 390px and 1280px, with no horizontal overflow. These are component/hook and static layout fixtures, not authenticated end-to-end browser tests.

Relevant legacy regressions: Sales parity/receipts, purchase offline/lots, product process UI, Farm Services database/UI/offline/receipt routes, Tamil receipts and Phase 1A UI. Results are in the implementation handoff. Focused lint covers changed application files; existing SalesManager unused-variable warnings may remain.

Actual local results:

- PASS: `legal-masters-database.mjs` replay through 062, including new unified-save/classification/rollback/permission checks; `farm-services-database.mjs`; `purchase-lots-database.mjs`.
- PASS: `unified-party-ui.cjs`, `unified-party-mobile.cjs` (24 component fixtures at three widths), and `legal-masters-ui.cjs`.
- PASS: `sales-parity-046.cjs`, `sales-receipt-047.cjs`, `purchase-lots-offline.cjs`, `farm-services-ui.cjs`, `farm-offline-shell.cjs`, `farm-receipt-route.cjs`, `tamil-receipts.cjs`, `product-process-ui.cjs`.
- PASS: TypeScript without writing the existing build-info file; production build with 70 pages; whitespace checks.
- Focused ESLint: zero errors. Two pre-existing warnings in `SalesManager` (`OfflinePosLink`, `setTab` unused); the newly added files have no lint warnings.

## Manual QA before rollout

1. On a separately configured local Supabase database through 062, open a customer from the list. Confirm phone/address, all legal fields, addresses/defaults, VAT periods and payment terms appear together. Switch all tabs and languages on mobile and desktop.
2. Click Edit, change basic and legal values, switch tabs, Save, reload and confirm both changed on the same original ID. Cancel another edit and verify all fields revert. Decline a discard prompt on Back, an app link and browser Back; confirm the draft stays. Accept it and verify navigation succeeds. Test reload/close warnings in a real browser after interacting with the form.
3. Repeat for a supplier from Purchases and from Masters-only access, including NIC/registration, bank details and notes. Confirm original free-text addresses and structured address defaults remain distinct and optional.
4. Set Individual while retaining registered VAT history, then Company while retaining unknown/unregistered history. Neither operation should alter VAT periods. Unspecified existing records must not be automatically reclassified.
5. Try invalid/overlapping VAT periods, duplicate default addresses, invalid classification and a stale second-session edit. Basic and legal values must roll back together; the UI must retain the failed draft. Hidden-tab required fields should reveal their tab when validation fails.
6. Test ordinary operator quick creation in the unified screen and existing Sales/Purchases/Services dialogs. Verify only existing basic-create rights apply and no TIN/VAT field is required. Full editing remains administrator-only.
7. As a center-restricted operator and another tenant, try direct URLs and RPC calls. Verify no foreign/unassigned customer appears. Services-only users should see shared invoice dues without gaining stock-sale or issuer-settings access.
8. Compare Transactions totals/due with existing receivable/payable screens; follow allowed payment links without introducing payments. Check a cancelled transaction and an outstanding shared stock invoice under Services access.
9. Open an old legal link with and without an ID. Verify it redirects to the correct unified record/list and no separate legal form/button remains.

Not performed: authenticated local Supabase/Preview sessions, real multi-connection PostgreSQL races, remote migration/deployment or native-speaker review. Browser history/unload guards should be manually checked in supported browsers; unload prompts require prior user interaction and browser permission.
