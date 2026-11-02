# Customer NIC and master layout

Local work on `development-trade-accounting`; no commit, push, deployment or remote migration.

The decorative avatar and its grid column are removed. Customer/supplier master view mode renders label/text pairs rather than disabled controls. Edit controls are borderless with subtle backgrounds, explicit labels and a three-pixel keyboard focus outline. The root card and child enclosing boxes are removed; light section separators remain. Styles are scoped under `.party-master`; other application inputs are unchanged. Tabs support Tab plus arrow/Home/End keyboard navigation. Existing Edit/Save/Cancel, permissions and draft warnings remain.

Customer General places an optional **NIC** beside Individual/Company. Supplier NIC/registration remains its existing separate field. Customer NIC is separate from business registration, TIN and effective VAT history. Labels, help and format errors are provided in English, Sinhala and Tamil. Only changed NIC values are normalized/validated; invalid legacy values remain exactly as stored on unrelated saves.

## Migration

Apply **064_customer_nic.sql after 063** (and the complete preceding foundation). Historical migrations are unchanged. Prepared and tested locally only.

064 adds nullable `customers.nic` as text with no backfill. A guarded trigger trims browser-equivalent whitespace and uppercases a trailing lowercase V/X. Nonempty new/changed values must match nine digits plus V/X or twelve digits. Null/blank is optional. Numeric JSON input is rejected to prevent treating identifiers as numbers. This is format validation, not identity verification. There is no uniqueness or identity-verification claim.

The existing `read_party_master`/`save_party_master` signatures remain unchanged. Detail read includes customer NIC; atomic save accepts it through the same permissions, revision and transaction. Direct writes also run the NIC guard. Existing customer table tenant/center RLS remains in force. Lists, quick-create RPCs, receipts and legal snapshots do not gain NIC. Audit records contain only field-change metadata, never the NIC value. Supplier combined identifiers are never copied. Unchanged legacy strings, including their whitespace/casing, are not normalized by an unrelated edit.

## Local verification

```powershell
$env:PGLITE_MODULE = Join-Path $env:TEMP 'centerpro-lot-tests/node_modules/@electric-sql/pglite/dist/index.js'
node tests/legal-masters-database.mjs
node tests/unified-party-repair.mjs
node tests/farm-services-database.mjs
node tests/purchase-lots-database.mjs
node tests/unified-party-ui.cjs
$env:PARTY_LAYOUT_DIR = Join-Path $env:TEMP 'centerpro-party-nic-layout'
$env:PLAYWRIGHT_MODULE = Join-Path $env:TEMP 'centerpro-farm-browser/node_modules/playwright-core'
node tests/unified-party-ui.cjs
node tests/unified-party-mobile.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
```

The PGlite suite checks migration preservation, new/changed formats, whitespace/V/X normalization, leading zeros, optional null/blank, unchanged invalid legacy data, atomic failure, refreshed RPC reads, no NIC in audit/snapshot data, and tenant/center/role boundaries. UI tests cover plain text view, edit/save/cancel, NIC errors and error focus, keyboard tabs, retained drafts and translated catalogs. Chromium fixtures cover both modes, both party types, three languages, all four tabs and 360/390/1280px widths (144 combinations), including actual border widths, focus outlines and an outside control proving styles stay scoped. Mobile/desktop fixture screenshots were inspected locally.

Relevant billing regressions: Sales parity and receipts, purchase offline/lots, Services database/UI/offline/receipt route, Tamil receipts and existing Phase 1A UI. Actual results are in the handoff. Component fixtures do not establish authenticated Supabase browser behavior.

Actual local results: all listed database/UI/layout suites passed, including replay through 064, repair-063 regression, Services and purchase-lot database suites, 144 Chromium layout combinations and NIC/error keyboard focus checks. The listed billing/receipt regressions passed. TypeScript, production build (70 pages), focused ESLint on all changed application TypeScript files and whitespace checks passed. No authenticated remote session or remote migration was used.

## Manual QA

1. With a separate local database through 064, open a customer and supplier. View mode must show text without an avatar or disabled boxes. Edit must show borderless controls with clear focus when tabbing; test arrow/Home/End navigation in the tab bar.
2. As an authorized admin, enter a test NIC with a leading zero, surrounding whitespace and lowercase v/x. Save, refresh the page and verify the zero remains and suffix is uppercase. Verify a twelve-digit text value similarly. Clear NIC and save; ordinary cash/credit/Services transactions and quick creation must still work without it.
3. Enter an invalid length/letter/internal space. Save must retain the draft, reveal General, focus NIC and show the translated error. Try direct RPC invalid input: all basic/legal changes must roll back. Cancel restores the last saved value.
4. On a fixture containing an invalid legacy customer NIC, edit only phone/name and save. NIC must remain byte-for-byte unchanged. No supplier field should populate customer NIC.
5. Repeat as an unauthorized operator, unassigned center and another tenant. Edits must fail under existing boundaries. Verify customer lists, receipts and audit payloads omit NIC.
6. Check 360px mobile, desktop, long addresses, all languages, tab changes and navigation warnings. Compare transactions/dues with existing screens; no financial posting should occur from these master edits.

Not performed: remote SQL, deployment, authenticated Supabase/browser refresh sessions, real multi-connection PostgreSQL tests or native-speaker translation review. Refresh persistence is verified by fresh database RPC reads; authenticated UI refresh remains a manual QA step.
