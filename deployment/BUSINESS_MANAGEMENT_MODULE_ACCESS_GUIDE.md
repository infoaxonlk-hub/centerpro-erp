# CenterPro business management, subscriptions and module access

Implementation branch: `feature/business-subscriptions-modules`, created from `development`. No production deployment or production SQL execution was performed. Review and integrate the tested feature into development, validate its Vercel Preview, then release through a pull request into main. No push or merge is performed automatically. Migration 044 is unchanged.

## Architecture and access policy

The existing Supabase Auth account, profile, organization_id ownership, center scopes, user permissions and 044 tenant guards remain in place. Business entitlements are separate from profile permissions.

Effective operational access requires an active profile, active business, usable subscription, enabled module (and its parent where applicable), and the existing role/user permission.

- Business status and subscription status are independent.
- Only business status `active` permits operations. Other current/future status values fail closed.
- A subscription must be `active` or `trialing`, have started, and not have expired. Trialing also requires a current trial end date.
- Dates use Asia/Colombo. An expiry/trial date remains valid through that entire date.
- `past_due`, `expired`, `cancelled`, future starts and elapsed dates block operational reads and writes. There is no automatic billing or grace period.
- Account/support/sign-out remain available. Active platform super admins retain the Businesses portal even when their own business is suspended or expired.
- Existing organizations are grandfathered with all 18 current modules and a Custom active subscription without expiration.
- New portal/API business provisioning applies only the selected modules plus mandatory Dashboard. Dashboard represents core navigation/account support, not permission to use other modules.
- The original create payload with name/adminName/email/password is accepted for compatibility. Without a module selection it provisions mandatory core only.
- Admin notes and subscription history are platform-private. Safe own-business subscription fields are readable by business users. Notes are redacted from tenant-visible audit records.

Database enforcement combines additional restrictive RLS policies with the original tenant policies, business-state checks on every operational write (including SECURITY DEFINER writes), and module/user checks at existing public RPC entrypoints. Existing RPC OIDs, grants, signatures and transactional bodies are preserved. There is no organization switch in profiles and no browser service-role key.

## Ordered database deployment

First validate against a separate test Supabase project or staging database with the schema through 044. Preview using production Supabase credentials still uses the production database; a Git branch does not isolate data or schema.

1. Confirm migrations through `044_multi_tenant_businesses.sql` are already applied, including 039, 042 and 043. Back up the database using the normal Supabase backup/export process.
2. Run **045_business_access_schema.sql** in the Supabase SQL Editor and wait for its transaction to commit. This adds business status, the module catalogue, subscriptions, entitlements and private history, then backfills existing organizations.
3. Run **046_business_access_enforcement.sql** and wait for commit. This adds restrictive module/business RLS, delete/write guards, business-aware existing helpers, and guards the current installed RPC overloads. It also adds narrowly scoped Labor/Scrap read helpers while preserving their existing role capabilities.
4. Run **047_platform_business_management.sql** and wait for commit. This adds service-only atomic configuration/provisioning RPCs with verified platform actors and audit/history records.
5. Run the read-only checks in `deployment/verify_business_access.sql`. Verify legacy businesses have active subscriptions without expiry and all expected entitlements. Check the new policies, triggers and guarded RPCs.
6. Configure the Preview environment variables below and deploy the feature branch to Preview only when ready. Exercise the manual checklist below with real test accounts.
7. For production, schedule a controlled rollout: pause new business provisioning/configuration changes, back up, apply 045 then 046 then 047 in that exact order, then deploy the tested application. Do not change entitlements or business statuses until the new application is ready.
8. Verify the production release with dedicated demo businesses before resuming platform administration.

Each new migration is transactional and intended to run once. Do not edit or re-run 044. If a migration fails, its transaction should roll back; investigate the reported prerequisite/SQL error before proceeding. Do not skip to a later migration or remove tenant security to get past a failure.

No data is deleted by these migrations. 046 also fixes a pre-existing 030 Scrap posting defect: a header was inserted with default quantity zero despite a strictly-positive CHECK. It now seeds the requested total and retains the existing validation/final accounting, all in one transaction.

## Environment variables

Existing required variables, matching the same Supabase project:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only

Optional new variable:

- `INFOAXON_SUPPORT_URL` — an organization-verified https URL or mailto destination. A WhatsApp link can use an https destination supplied by InfoAxon. No unverified number/email is hardcoded.

Without the support URL, the app still renders an account/support information fallback. Configure it to provide a direct support contact link. Redeploy after environment changes. Never give the service-role key a NEXT_PUBLIC prefix.

## Business creation and editing

Sign in as an active platform super_admin and open Businesses. The portal includes search by name/ID/admin, status/expiry filters, status counters, module counts and an action menu for each business.

Create business:
1. Enter business name, optional contact details and the first admin's name/email/password.
2. Configure the manual subscription.
3. Select Module Access. Enable all and Disable optional modules are available; Dashboard is mandatory.
4. Save. Auth creation is followed by a single database transaction for organization/profile/configuration/history/audit. A failed transaction attempts Auth-user cleanup.
5. Share sign-in credentials through your usual secure channel. Admin passwords are neither returned nor displayed in business details.

The administrator uses the normal login URL and remains scoped to that organization. Their initial user permissions cover the selected capabilities. Business-level assignment never adds permissions to existing users.

Use View details for a read-only view. Edit business, Manage subscription and Manage modules open the appropriate section of the same editor. Saving preserves the organization ID and existing record ownership.

## Suspend, activate and reactivate

Use the row action Suspend business, or change the status in the editor. Suspension asks for confirmation. Existing records remain intact; new operational reads/writes/RPC calls fail for existing sessions as well as new logins.

Affected users see:
"Your business account is temporarily suspended. Please contact InfoAxon Support for assistance."

Reactivate/Activate restores access only if the subscription, modules and user permissions also allow it. Reactivation does not reset module selections or renew an expired subscription.

The UI rechecks access on focus/reconnection and every 30 seconds. Database enforcement applies to each new request immediately; it does not depend on waiting for the UI refresh. A transaction already in progress uses PostgreSQL's normal transaction-snapshot semantics.

## Subscriptions and renewals

Choose Starter, Professional, Enterprise or Custom. Set status, start, expiration, optional trial end and private platform notes.

For a fixed renewal, set status active and choose a valid start/new expiry. Renew without expiry clears expiry/trial end and starts an active subscription today. Review all fields before saving.

Details include the most recent 50 subscription-history entries with previous/new configuration and timestamps. History is written only when subscription content changes. Expired and expiring-within-30-days filters use server-derived summaries; database dates remain authoritative for access.

## Module catalogue and permissions

| Module | Existing user permission / role | Dependency |
| --- | --- | --- |
| Dashboard/core | dashboard | Mandatory |
| Purchases | purchases | — |
| Sales | sales | — |
| Inventory / Stock | stock | — |
| Stock Transfers | stock | Inventory |
| Stock Adjustments | stock_adjustment | Inventory |
| Labor & Sessions | labor | Expenses (existing wage-posting dependency) |
| Cash Management | cash | — |
| Bank Management | cash + admin/super_admin | — |
| Expenses | cash | — |
| Payment Reports | payment_reports | — |
| Cheque Management | payment_reports | — |
| Customer Receivables | sales | Sales |
| Supplier Payables | purchases OR payment_reports | — |
| Centers & Locations | centers | — |
| Products & Suppliers/Masters | masters; product_create/product_edit retained | — |
| Users & Access | users + admin/super_admin | — |
| Audit Log | audit | — |

Selecting a dependent module enables its required parent. Disabling a parent clears dependent selections. Business admins cannot modify entitlements through RLS, management RPCs or the platform APIs; the user-management API also rejects grants for unavailable business capabilities.

Shared supporting data remains usable inside entitled workflows. For example, a purchase still posts its stock/accounting side effects when the standalone Inventory/Cash workspace is unavailable, and Sales/Purchases can read their required product/bank lookups. Entitled payment/payable reports retain supporting purchase-bill lookups without enabling purchase mutations or purchase-page access. This does not enable Masters editing, Inventory exploration or Cash administration.

The existing delegated center-user Scrap capability is preserved through a scoped snapshot/Scrap RPC. It does not grant Stock explorer, stock-adjustment permission or direct raw stock-ledger reads. Labor-only users similarly receive scoped linked-order weights/counts and wage posting, without receiving Purchases, Sales, Cash or general Expenses permissions.

Disabled modules remain discoverable with their normal icons and a lock in the sidebar, dashboard cards and AppearanceShell grouped/cards/apps/list navigation. A locked entry opens:
- Heading: "Module Access Restricted"
- Message: "This module is not available for your business. Please contact InfoAxon to enable access."
- Configurable Contact InfoAxon Support option

Enabled modules retain normal user-permission/role filtering. Informational locked entries can be shown even to a role that could not operate the enabled workspace; they grant no operational access. Nested paths use the most specific module mapping.

## Read-only Super Admin inspection

Select Open Workspace in a business action menu. This opens a separate support route under `/dashboard/businesses/[id]/workspace`, with the business name/ID, a READ-ONLY banner and Back to Businesses.

Supported snapshot sections:
- Overview counts, centers and locations
- Purchase orders and child lines
- Sales orders and child lines
- Inventory movements, transfers and adjustments
- Labor sessions
- Cash ledger and bank accounts
- Expenses and payments/cheques
- Receivables and payables
- Products and qualities
- Business users and audit activity

Each root query has an explicit organization_id filter; child collections are fetched through its scoped parent. The server validates an active platform super admin on every request. Selection/section/page access writes audit evidence. No mutation endpoint or operational action is provided in this context.

Inspection uses 50-record pages and allowlisted fields. It supports suspended/expired businesses because it is a separate platform support capability. Normal ERP navigation continues to refer to the operator's own organization; it never silently switches tenants.

Not supported in inspection: POS, bill editing/printing, financial posting, inventory adjustments, full operational report filters, product photo URLs, or the complete interactive operational screens. Users should not assume normal ERP links act on the inspected business.

## Offline and caching behavior

Authenticated ERP HTML is no longer cached by the service worker under shared URLs. The worker replaces/removes its old shell cache. Reopening a workspace requires connectivity to verify current business access.

Already-open POS pages can keep user-scoped local drafts/queued requests. They do not commit server financial/stock changes offline. Every actual confirmation or later sync calls the newly guarded database RPC again. Revoked/expired/suspended access cannot commit a queued transaction. Reconnection/focus refreshes the access state.

Information already delivered into an open tab, downloaded file or browser storage cannot be remotely erased while the device is offline. Database boundaries protect future reads/writes, not previously received information. Treat shared devices according to your normal account/device procedures.

## Automated verification

Run after npm ci:

```powershell
node tests/multi-tenant-api.mjs
node tests/business-access-navigation.mjs

# Isolated PostgreSQL tests; this dependency can live outside the repository.
npm install --prefix "$env:TEMP\centerpro-tenant-checks" --no-audit --no-fund @electric-sql/pglite
$env:PGLITE_MODULE = Join-Path $env:TEMP 'centerpro-tenant-checks/node_modules/@electric-sql/pglite/dist/index.js'
node tests/multi-tenant-database.mjs
node tests/business-access-database.mjs

npx tsc --noEmit --incremental false
npm run build
npm run lint
```

Also run the existing tests/*.cjs regression scripts. Their old dashboard/source assertions were updated to read the centralized catalogue/current cash/bank navigation.

Executed verification:
- PostgreSQL integration tests: existing tenant isolation and normal purchase/sale/cash posting; all three migrations; legacy backfill; atomic provisioning rollback; suspension/reactivation; subscription expiry/trials/start dates; module and user permissions; privileged-write safeguards; metadata privacy; private wage posting; delegated Scrap posting; selected-business isolation; inspection column/FK validation.
- API tests with mocked Supabase/Auth: authorization and HTTP statuses; provisioning and compensation; edit actor/organization binding; all 17 read-only inspection sections and scoping; direct server-route restrictions; business-admin permission-grant restrictions.
- Server-rendered UI tests: locked modules in cards/apps/list and nested navigation, normal icons, restricted destinations and preservation of user permission filtering.
- TypeScript and production build passed.
- Repository-wide ESLint still reports 69 pre-existing errors and 16 warnings. A per-rule comparison of changed files against HEAD found zero introduced ESLint errors. New implementation files pass focused ESLint. Existing errors include AppearanceShell's older synchronous effect setters and CommonJS test imports.
- No live Supabase/PostgREST, Vercel deployment or browser visual/interaction test was performed.

## Manual release checklist

Use two test businesses, separate browser sessions and a platform super admin.

1. Create a business with only selected modules; verify ordinary login, its administrator's permissions, initial empty data and no password in API responses.
2. Edit name/contacts; verify IDs/ownership and existing records do not move.
3. Suspend while a user is already logged in. Confirm account/support rendering and denied direct REST writes/RPC confirmations.
4. Reactivate and verify selected modules/permissions persist.
5. Test active/trialing/past_due/expired/cancelled, elapsed and inclusive-today expiry, future start and manual renewal; inspect history.
6. Disable Sales, Inventory, Bank, Labor and their relevant child modules in turn. Check all navigation modes and direct nested/detail URLs.
7. Try direct Supabase REST/RPC requests, saved URLs and queued POS sync after revocation.
8. Give an existing user no Stock permission while Inventory is enabled; Stock explorer/adjustments must remain inaccessible. Separately test the preserved delegated center-user Scrap workflow.
9. Verify a business admin cannot call platform create/edit/inspection APIs or modify subscription/entitlement tables, even with forged organization/actor IDs.
10. Verify Business A cannot read/update Business B's records or link its foreign keys.
11. Inspect Business B explicitly as super admin; confirm every section belongs to B, no operational buttons exist, and audit events record the selected business.
12. Validate real Supabase PostgREST nested relationships and service-role grants, product-image signed URL behavior and database schema cache refresh.
13. Check purchase/POS, sales/POS, inventory, transfers, adjustments, labor wages, cash, bank, expenses, reports, payments and cheques with their real user roles.
14. Test mobile layout, long business names/emails, searching/filtering, editor keyboard focus/Escape, loading/error/empty states, support destination and sign-out.
15. Review database query latency on production-sized datasets. The generic 044 inherited-ownership checks remain and can be expensive on large child-table scans.

## Maintenance and rollback

Prefer a forward fix. Reverting only application code leaves the database's new security checks in place, so an older app may show generic denial errors instead of the new account/module screens. Do not drop the new tables, disable RLS, remove tenant triggers or broadly re-enable customers as a rollback shortcut.

For an application rollback, restore the previous deployment, preserve database data/security, and review affected businesses' known-good configuration/history with an authorized platform operator. Do not reactivate a deliberately suspended business merely to make old UI calls work.

A future migration that replaces a guarded public RPC must retain its business/module/user check. New operational tables need tenant ownership, business/module policies and write/delete protections. Update both the TypeScript registry and SQL catalogue/permission mapping when adding module keys. The private wage expense-posting implementation must stay in sync with any later changes to the corresponding expense workflow.

Auth user creation and the database transaction are separate services. Compensation is attempted, but a network/cleanup failure can leave an orphan Auth account or an uncertain successful request. Server logs identify cleanup-required user IDs; reconcile these through the trusted platform/Supabase admin tools before retrying. There is no payment gateway or automatic charging.

The database RPC guards are installed against the current migration history. Re-run the staging integration suite against the actual deployed schema before release; do not assume extra out-of-repository RPC overloads or policies are covered.

## Changed files

The following manifest lists application, migration, test and deployment changes for this implementation.

- .env.example
- app/api/admin/businesses/[id]/route.ts
- app/api/admin/businesses/[id]/workspace/route.ts
- app/api/admin/businesses/route.ts
- app/api/admin/users/route.ts
- app/api/business-access/route.ts
- app/dashboard/account/page.tsx
- app/dashboard/businesses/[id]/workspace/page.tsx
- app/dashboard/businesses/businesses.css
- app/dashboard/businesses/business-manager.tsx
- app/dashboard/businesses/page.tsx
- app/dashboard/labor/screen.tsx
- app/dashboard/layout.tsx
- app/dashboard/masters/product-image-actions.ts
- app/dashboard/page.tsx
- app/dashboard/restricted/page.tsx
- app/dashboard/stock/scrap/page.tsx
- app/dashboard/users/page.tsx
- app/dashboard/users/users-manager.tsx
- app/module-access.css
- components/appearance-shell.tsx
- components/app-shell.tsx
- components/business-access-monitor.tsx
- components/module-access-checklist.tsx
- components/product-catalog-screen.tsx
- components/sidebar-navigation.tsx
- components/support-contact.tsx
- deployment/BUSINESS_MANAGEMENT_MODULE_ACCESS_GUIDE.md
- deployment/verify_business_access.sql
- lib/access.ts
- lib/business-access.ts
- lib/business-inspection.ts
- lib/business-modules.ts
- lib/business-types.ts
- lib/platform-businesses.ts
- proxy.ts
- public/service-worker.js
- README.md
- supabase/migrations/045_business_access_schema.sql
- supabase/migrations/046_business_access_enforcement.sql
- supabase/migrations/047_platform_business_management.sql
- tests/bank-management-043.cjs
- tests/business-access-database.mjs
- tests/business-access-navigation.mjs
- tests/cash-navigation-ui-041.cjs
- tests/multi-tenant-api.mjs
- tests/navigation-regression.cjs
