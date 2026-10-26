# Business admin sees only Dashboard/Audit after enabling more modules

## Cause

The first administrator receives user permissions for the modules selected when the business is created. Enabling additional business modules later updates the business entitlements, not that user's permissions. Enabled modules lacking user permission are hidden by normal navigation filtering.

This separation remains intentional. Changing a subscription or business module must not silently widen every user's permissions.

## Deploy this fix

If 045, 046 and 047 have already succeeded:

1. Run only `supabase/migrations/048_business_admin_module_permissions.sql` in the Supabase SQL Editor. Do not rerun the earlier migrations.
2. Deploy the updated development branch to Vercel Preview using the normal workflow.
3. As an active platform Super Admin, open Businesses.
4. On the affected business choose **Administrator access**, or use **Edit business → Administrators & history**.
5. Review the missing permissions listed under the intended administrator.
6. Click **Grant enabled-module access** for that administrator.
7. Refresh that administrator's workspace (or sign out and in). The access monitor also picks up the permission change on focus/reconnection or its normal 30-second check.

If module selections are still unsaved, save them first. A business with no enabled optional modules still receives only core access.

048 installs the capability; it does not automatically grant permissions to existing accounts. The operator explicitly selects the business/admin and grants access.

## Safety and behavior

- Only the active platform Super Admin can call the new API.
- The service-only RPC validates the platform actor again.
- The target must be an active `admin` inside the selected business. Cross-business, center-user and super-admin targets are rejected.
- Added permissions are derived in PostgreSQL from currently enabled/effective modules, never from a client-supplied permission array.
- Masters includes product creation/editing; Stock Adjustments retains its Stock prerequisite.
- Existing permissions are retained. Other users, business entitlements, subscription settings, roles and organization IDs remain unchanged.
- Suspension, subscription expiry and disabled modules still block operations even if a user retains its permission.
- Audit event: `business_admin_access_granted`, scoped to the selected business and profile.
- `current_business_access()` includes only the signed-in user's safe role/permissions so an already-open shell can refresh after permission-only changes.

## Verification performed

- Isolated PostgreSQL reproduces Dashboard/Audit-only provisioning, then enables additional modules and proves user permissions do not change until the explicit grant.
- Explicit grant, action permissions, idempotence, audit scope and unchanged other users/businesses/settings.
- Unauthorized roles, cross-business targets and inactive/staff/super-admin targets rejected.
- Business restrictions still apply after repair.
- API actor/organization/admin binding, rejection of ordinary callers, client-permission-array isolation and sanitized errors.
- Rendered UI missing-permission state, completed state and disabled/read-only controls.
- Existing tenant, subscription and navigation regression suites.

Run:

```powershell
node tests/multi-tenant-api.mjs
node tests/business-access-navigation.mjs
$env:PGLITE_MODULE = Join-Path $env:TEMP 'centerpro-tenant-checks/node_modules/@electric-sql/pglite/dist/index.js'
node tests/business-admin-access-database.mjs
node tests/business-access-database.mjs
node tests/multi-tenant-database.mjs
npx tsc --noEmit --incremental false
npm run build
```

No live database update or deployment is performed by creating these source changes. Verify the affected account in Preview after applying 048 and deploying the code.

## Rollback

Application rollback can leave 048 installed; it is additive. Do not remove tenant RLS or widen all profiles as a rollback shortcut. The new function does not change existing accounts until explicitly invoked.

If a grant was made to the wrong administrator, review that profile's scoped audit event and restore its previous user permissions through the normal authorized user-management process. Do not alter business ownership or remove business module restrictions.
