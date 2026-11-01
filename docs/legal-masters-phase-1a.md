# Phase 1A: legal party and issuer masters

Implemented locally on `development-trade-accounting` after the authorized fast-forward to `cbd98c43bb21d08535684b99c514b786a632ba19`. Historical migrations 001–060 were retained as integrated. The original untracked audit and `tsconfig.tsbuildinfo` were preserved. No remote migration, commit, push or deployment was performed.

## Migration order and local setup

The only new migration is [061_legal_masters.sql](../supabase/migrations/061_legal_masters.sql), after 058 Farm Services, 059 platform module repair and 060 Services/KG. Replay the repository migration sequence into an **isolated local** database with Supabase auth/storage schemas, or use the PGlite harness below. Do not rerun or renumber applied files. A deployed database's migration history must be separately verified before later authorized rollout.

```powershell
# Use an existing local install; otherwise install test dependencies outside this repository.
$legalTestDeps = Join-Path $env:TEMP 'centerpro-legal-tests'
npm install --prefix $legalTestDeps --no-save @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $legalTestDeps 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/legal-masters-database.mjs
node tests/legal-masters-ui.cjs
node tests/farm-services-database.mjs
node tests/purchase-lots-database.mjs
node tests/production-costing-database.mjs
node tests/sales-parity-046.cjs
node tests/purchase-lots-offline.cjs
node tests/farm-services-ui.cjs
node tests/farm-offline-shell.cjs
node tests/farm-receipt-route.cjs
node tests/tamil-receipts.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
```

The audit used the already available PGlite installation under the temporary `centerpro-lot-tests` directory. Its harness creates a new in-memory database and mock auth/storage schemas; it never connects to Supabase or reads application credentials. For browser/manual QA use a separately configured local Supabase development database and `npm run dev`. Do not use a hosted production database for QA. Build output is local and does not deploy or apply SQL.

## Data and permissions

Existing customer/supplier/organization IDs and legacy master columns remain. Optional new columns: `registered_name`, `trading_name`, `legal_email`, `business_registration_number`, `tin`, `payment_terms_days`, `payment_terms_note`, plus `legal_revision` for stale-edit detection. Legacy `nic_or_registration`, free-text addresses, receipt contacts and bank details are not converted into legal/tax claims. TIN does not imply VAT registration. New legal email is separate from existing receipt email, allowing legacy printing to remain unchanged.

`legal_addresses` and `legal_vat_registrations` use explicit customer/supplier/issuer FKs, exactly one owner and organization identity. RLS checks legal-master access, with tenant and operation write triggers and explicit cross-tenant FK validation. Authenticated clients have SELECT only on child tables; full edits go through `save_legal_master`. RPC grants exclude anon/public. Parent legal-field changes through older direct APIs are also guarded and audited.

Editing legal details requires an administrator **and** the existing appropriate module/user permission. Customer access additionally requires the existing sales-center or Farm-center access; supplier access uses the existing supplier module policy. Issuer access requires Users permission/module and administrator role. An administrator with no module permission is rejected. Customers remain center-scoped and suppliers organization-scoped. Services-only admins can maintain the same shared customers without obtaining Sales or Users access. Ordinary operators may view permitted records but cannot edit legal fields. Existing quick customer/supplier creation remains available through its unchanged APIs and screens with only the previous required fields.

Master edits are atomic and reject stale `legal_revision` values. Arrays in the save payload are complete replacements, not append patches. Existing master IDs remain; child row IDs can change on a complete edit. Audit records contain field names, entity identity and address/VAT-period counts, not TINs, VAT numbers, address values or bank details. Existing older audit behavior outside Phase 1A is unchanged.

Address purposes: billing, delivery and registered. At most one default per purpose and typed owner. If none is default, snapshot selection uses canonical serialized address content order, then ID as a tie breaker. No address means null; no address-purpose inference from other purposes or legacy free text. Country defaults to LK only when the user creates a new address; no historical address backfill occurs.

VAT periods use `[valid_from, valid_to)` (start included, end excluded). Missing end means open ended. Periods cannot overlap for the same typed owner; zero-length/reversed/nonfinite dates fail. Status is registered, not registered or unknown; registered requires a separate registration number and other statuses disallow one. Gaps mean unknown. This is master data validation, not legal verification of a taxpayer or an active tax calculation rule.

## UI entrypoints

- Sales → Customers → Manage customers → Legal details and addresses: `/dashboard/sales/customers/legal`.
- Purchases → Suppliers → Legal details and addresses: `/dashboard/purchases/suppliers/legal`.
- Masters → Suppliers → Legal details and addresses: `/dashboard/masters/suppliers/legal` (preserves Masters-only access).
- Services → Customer Accounts → Legal details and addresses: `/dashboard/farm-services/customers`.
- Users → Company profile → Legal details and addresses: `/dashboard/users/legal`.

Each party screen offers name search, record detail, administrator create/edit, multiple addresses and VAT periods. Business screen edits the existing issuer only. Existing quick-create UI stays in place. New screens provide an English/Sinhala/Tamil selector; all new copy comes from `lib/legal-messages.ts` with English fallback. Existing receipts and their language selection are unchanged. Sinhala/Tamil translations and fonts should receive native-speaker/browser QA before rollout.

## Future-document snapshots

`build_legal_snapshot(kind,id,date)` returns version 1 with the authorized master identity/legal data, deterministic address choices and VAT status for the supplied date. It is a permission-checked stable database function; `buildLegalSnapshot` in `lib/legal-masters.ts` returns an owned JSON value and validates the version. Future posting code must persist this value in the posted document within its posting transaction and protect that document from mutation. Reprints must read stored snapshots. This phase does not modify existing invoices or claim their missing historical fields are known.

The `as_of` date selects VAT registration history only. Other fields are the current master state at capture time; this API cannot reconstruct past names/addresses. No existing document automatically calls it. Tax rates, invoice eligibility/numbering and legal IRD reporting are deferred to the tax configuration phase.

## Manual QA

1. With a local database through 061, open each entrypoint as an allowed administrator. Search, create and edit a party; reload and verify all optional legal values, address purposes and VAT periods. Issuer editing must retain the organization ID and existing receipt contacts/logo.
2. Create a name-only customer in Sales and Services and a quick supplier in Purchases. Confirm ordinary cash billing still needs no TIN/VAT/legal address. Existing credit customers/suppliers must retain IDs, dues and order references.
3. Enter two default billing addresses; save must fail without partially changing the master. Remove both defaults; capture a snapshot and verify canonical address selection. Verify missing registered address stays null.
4. Add registered VAT from 1 January until 1 July and not-registered from 1 July. Snapshot 30 June is registered; 1 July is not registered; a prehistory date is unknown. Overlap, missing registered number, equal/reversed dates and invalid email must reject atomically.
5. Open the same master in two sessions. Save one; the stale second save must reject. Reload the record and retry intentionally.
6. As a center user, view only permitted customer legal details and confirm editing is disabled. Try RPC saves directly: reject. Repeat with an admin lacking module permission, a foreign tenant ID, an unassigned center and a disabled module. Business legal settings must be hidden from Services-only admins.
7. Capture/store a version-1 snapshot, edit names, addresses and registrations, then verify the stored JSON is unchanged. Do not attach newly captured data to historical invoices.
8. Select all three UI languages, test a missing catalog key's English fallback, keyboard navigation, long addresses and 360px width. Existing EN/SI/TA receipts and offline Services printing must retain their behavior.
9. Confirm no stock, lot value, cash/bank entry, payment, receivable, payable, invoice or journal is created by master saves. Check audit records contain metadata rather than tax/address/bank values.

## Validation boundary

Actual results on this working tree:

- PASS: `legal-masters-database.mjs`, including replay through 061 with existing master IDs, original fields, historical references and nonzero AR/AP balances seeded before 061; tenant/center/module/admin access; optional quick creation; VAT boundaries/overlap; default addresses; rollback; stale revisions; stored snapshots after master edits; audit redaction; no new financial/stock records.
- PASS: isolated `farm-services-database.mjs`, `purchase-lots-database.mjs`, `production-costing-database.mjs` against the migration sequence including 061.
- PASS: `legal-masters-ui.cjs` catalog/fallback, read-only/edit rendering and snapshot ownership tests.
- PASS: existing `sales-parity-046.cjs`, `sales-receipt-047.cjs`, `purchase-lots-offline.cjs`, `farm-services-ui.cjs`, `farm-offline-shell.cjs`, `farm-receipt-route.cjs`, `tamil-receipts.cjs`, `product-process-ui.cjs`, `purchase-pos-044.cjs`, `session-access-regression.cjs`, `platform-business-api.cjs`, `platform-business-editor.cjs`.
- PASS: TypeScript `--noEmit --incremental false`; final `npm run build` compiled, completed TypeScript and generated 70 pages, including all five new legal routes.
- PASS: focused ESLint on all new/modified application TypeScript/TSX files; `git diff --check`.

PGlite replay is not a substitute for real Supabase/PostgREST sessions, concurrent PostgreSQL connections, native-speaker review or authenticated browser/Preview QA. Those manual checks were not run. No remote deployment, physical printer check or migration was performed. Concurrent saves are serialized on the parent row and stale revisions rejected; real multi-connection concurrency remains a rollout check. Repository-wide lint was not run; lint was scoped to changed application files.

## Changed files (Phase 1A only)

- Database: `supabase/migrations/061_legal_masters.sql`.
- Shared UI/style: `components/legal-master-manager.tsx`, `components/legal-master-screen.tsx`, `components/legal-master-link.tsx`, `app/legal-masters.css`.
- Data/localization: `lib/legal-masters.ts`, `lib/legal-messages.ts`.
- New routes: `app/dashboard/sales/customers/legal/page.tsx`, `app/dashboard/purchases/suppliers/legal/page.tsx`, `app/dashboard/masters/suppliers/legal/page.tsx`, `app/dashboard/farm-services/customers/page.tsx`, `app/dashboard/users/legal/page.tsx`.
- Existing entrypoint links: `app/dashboard/sales/customers/manage/page.tsx`, `app/dashboard/purchases/suppliers/page.tsx`, `app/dashboard/masters/masters-manager.tsx`, `app/dashboard/farm-services/accounts/page.tsx`, `app/dashboard/users/company-profile.tsx`.
- Tests: `tests/legal-masters-database.mjs`, `tests/legal-masters-ui.cjs`.
- Documentation: this file and the preserved/revised `docs/trade-accounting-audit-plan.md`.
