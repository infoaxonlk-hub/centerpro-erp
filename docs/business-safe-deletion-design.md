# CenterPro ERP — Super Admin Business Safe Deletion
**Status:** Design proposal only. No application code or schema changes in this PR. **Do not merge as a finished feature.**

## Goal

Avoid keeping inactive-customer data in the operational database indefinitely **without** deleting stock, sales, purchases, accounting, audit, or user records accidentally.

**Critical distinction:** **Archive/soft delete does not save database space.** It hides and disables a tenant. Storage savings require a separately gated, backed-up purge. PostgreSQL may reuse space after VACUUM; the Supabase project's allocated disk does not necessarily shrink.

## Verified architecture (read-only review, 2026-11-21)

- Repository: `infoaxonlk-hub/centerpro-erp`; base: `development`. No production inspection or modification.
- `supabase/migrations/044_multi_tenant_businesses.sql`: organization ownership, restrictive tenant RLS, tenant write guards.
- `045_business_access_schema.sql`: `organizations.business_status` and `business_operational()`; status currently managed as `active` / `suspended` by the app.
- `046_business_access_enforcement.sql`: business-operational RLS/trigger restrictions.
- `047_platform_business_management.sql` + `059_platform_module_save_repair.sql`: service-role-only provisioning and save RPC; audited configuration history.
- `app/api/admin/businesses/route.ts`, `app/api/admin/businesses/[id]/route.ts`: super-admin create/list/update/detail only; **no deletion route**.
- `lib/platform-businesses.ts`, `lib/business-access.ts`, `lib/business-types.ts`: Zod validation, access/status computation, service-role reads.
- `app/dashboard/businesses/business-manager.tsx`: status toggles, list/edit/view; any non-active status currently risks being treated as reactivatable by the generic action.
- `supabase/migrations/038_product_images.sql`: product images in private `product-images` bucket, tenant-keyed object path. Storage policies check profile activity; review must add a business-operational guard during archive rollout.
- `public.audit_logs.organization_id` references `organizations`. Therefore this existing table **cannot be the only permanent-purge audit**: purging the organization would also require deleting its audit rows.
- **Staging only**, `centerpro_staging`: 76 public tables, 263 foreign keys on public child tables (250 NO ACTION, 17 CASCADE). 2 organizations and about 18 MB total database size at inspection; these **are not production metrics**. Direct organization references include financial, manufacturing, stock, user, legal, and audit records.
- Staging migration history readout is not a substitute for the release ledger. Follow `deployment/PRODUCTION_MIGRATION_RELEASE.md` and never edit historical migration files.

## Recommended state machine

```text
active / suspended
       |
       | Super Admin + reason + exact-name confirmation
       v
   archived   <------ Restore allowed while data retained
       |
       | retention/contract checks + backup + independent approval
       v
purge_requested -> purge_approved -> purge_running -> purged
       |                 |
       +-> cancelled <---+
```

1. **Suspend** remains the current temporary access restriction.
2. **Archive** removes the tenant from normal active lists, blocks tenant business API/RPC/data access, preserves all business data, retains membership/Auth accounts and an auditable reason. Archive never calls a delete API.
3. **Restore** returns the tenant to **suspended**, not active, so the operator explicitly reviews subscription, balance/retention concerns and module access before reactivation. Restore is only possible before purging.
4. **Purge** is a deliberately separate, multi-step administrative workflow. Never implement as a generic `DELETE /businesses/:id` or `ON DELETE CASCADE` across ERP tables.

## Phase 1: safe Archive / Restore (first implementation PR)

**Database:** append-only migration after 065. Add `archived_at`, `archived_by`, `archive_reason`, and optionally `pre_archive_status` to `organizations` (default NULL for existing tenants). Use `business_status='archived'` consistently with `business_operational()`, and database guards so generic `platform_save_business` cannot unarchive a tenant. Separate `platform_archive_business` / `platform_restore_business` functions, restricted to `service_role`, lock the tenant row and write lifecycle audit records atomically. Never archive the actor's own organization or any platform-operator organization. Do not permit archived business admins to edit subscriptions, grant permissions, or generate invoices.

**Storage access:** preserve private `product-images` objects, but tighten Storage read/write/delete policies to require an operational business. Check any other tenant-specific object buckets.

**API:** add `POST /api/admin/businesses/[id]/archive` with reason and exact-name confirmation, and `POST /api/admin/businesses/[id]/restore`. Enforce `requireSuperAdmin()`, same-origin checks, Zod UUID/input validation, server-side locked-row verification, no-store responses, and explicit error codes. The generic existing PATCH must reject transitions from archived.

**UI:** add Archived filter, a distinct Archived status, and a safe confirmation dialog that requires business name + reason. No archive for the Super Admin's own tenant. Archived rows expose View / Restore but **not** Edit / Reactivate / Workspaces or other dangerous actions. Mobile-first modal with focus handling and accessible touch targets. Show archive actor, reason, timestamp, history and data-retention warning.

**Audit:** record actor, tenant ID/name-at-time, action, reason, UTC timestamp, before/after status, request ID; exclude passwords and sensitive business payloads. Use an append-only private platform event table independent of the organization foreign key, so records can survive a future purge.

## Phase 2: cold storage and permanent purge (separate reviewed PR)

**No automatic permanent deletion initially.** Introduce `purge_requests`, `purge_approvals`, `purge_jobs`, and immutable platform audit in a private schema; non-service roles have no access. The feature is **disabled by default** until a verified, tested process exists.

Required gates:

1. Confirm archive status, retention period (suggested *policy default* 90 days, configurable; not a legal claim), customer contract/consent and statutory accounting retention. Hold when there are outstanding balances, pending operations, disputes, legal holds, or incomplete audit data.
2. Inventory actual tenant-owned rows **across all current tables and indirect foreign keys**, including manufacturing, lot traces, movements, accounting, sales, purchases, Auth dependencies, and legal master references. Fail closed if an unknown table or FK appears.
3. Produce encrypted, tenant-scoped SQL/structured-data export and separate `product-images/<organization-id>/...` object export with row-counts, checksums, schema version, manifest, and a **tested restore to an isolated project**. A generic Supabase project backup alone is not a tenant-scoped restore plan; DB backups do not include Storage objects.
4. Fresh super-admin reauthentication/step-up, exact business ID + name confirmation, two separate privileged approvals for real customers, minimum cooling-off window, one-use signed approval token, explicit job lock and idempotency key. Never purge the current operator's organization, a platform organization, or a non-archived tenant.
5. Run an ordered FK-aware deletion plan within controlled transactions/batches **only after** backups and manifest checks. `DELETE` must scope rows by verified tenant ownership and handle children before parents. Avoid broad dynamic cascade, `TRUNCATE`, temporary global policy disable, and mass deletion of `auth.users`. Auth-user cleanup must be separately reconciled with foreign-key references and session revocation.
6. Preserve a minimal cross-tenant-independent tombstone and permanent platform audit after purge; retain backup until the approved policy deadline. Do not log customer rows in audit.
7. Report rows/objects removed, bytes logically freed, vacuum/reuse status, export location and restore-test evidence. Never guarantee an immediate reduction in provisioned Supabase disk/cost.

**MVP purge eligibility:** consider *empty demo/trial tenants only*, and only after dynamically proving absence of all business/financial rows. Real customer purge stays blocked until full engine/backup tests pass.

## Change inventory / verification

- New SQL migration and matching `deployment/migrations/manifest.json` entry; preserve checksum/order/release controls.
- API, Zod, business types/selection, UI and business-access reason updates; Storage RLS changes.
- Tests: two-tenant isolation; own/super-admin protection; existing-session archive denial incl. direct SQL/RPC; image ACLs; generic PATCH cannot resurrect archived tenant; restore-to-suspended; no stock/sales/purchase/accounting data mutation; concurrent archive/restore; audit persistence; CSRF/replay checks.
- Purge tests: 76-table/FK graph coverage (and future tables), fake tenant full cycle, failed export, lost object, foreign key violation, retry/idempotence, concurrent operations, prohibited tenants, interrupted backup, independent approvals, recoverability.
- Test only against isolated test DB / `centerpro_staging` with explicit authorization; never auto-apply development migrations to the production DB; `CENTERPRO_AUTO_SETUP_DEV_DB` must be checked before starting a local dev server.
- PR target: `development`; migration + app feature should remain draft until DB tests, CI, full release-gate review and staging verification pass. No merges to `main`, Vercel Production changes, or production Supabase operations.

## Acceptance criteria

- Archive is not one-click and is reversible; existing business rows are unchanged.
- Business staff with active sessions cannot operate archived tenants, including Storage API.
- Archived tenants cannot be reactivated through generic status toggle/config PATCH.
- Restore never implicitly enables ERP use; explicit subscription/access review required.
- Permanent deletion is physically impossible before verification, backup, approvals, grace period and tested purge engine.
- Platform audit survives purge, with no spill of other tenant data.
- Operational data reduction and billed/allocated disk reduction are measured separately.

## Sources / references

- Repository files listed above.
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase database/disk size](https://supabase.com/docs/guides/platform/database-size)
- [Supabase safe data deletion](https://supabase.com/docs/guides/database/postgres/data-deletion)
