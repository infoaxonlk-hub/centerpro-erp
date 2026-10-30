# Platform module save / administrator access repair

Apply **059_platform_module_save_repair.sql** once after existing migrations (including 058). Do not rerun 058. The application and this migration form the fix; the application alone cannot repair the old database save function.

The previous save RPC only updated existing entitlement rows. Businesses created before a catalogue addition had no row for that new module, so saving could silently omit it. Migration 059 backfills missing optional entries as disabled and changes future saves to upsert every catalogue entry. Existing selections are preserved until explicitly edited. It also repairs the missing explicit Manufacturing permission in the platform administrator grant RPC. Actor validation, service-role-only execution, tenant checks and subscription/module restrictions remain intact.

The API now reads saved settings back before confirming success. A mismatch gives a visible 409 with the repair migration name. Missing RPC/database errors are surfaced with a safe code instead of claiming success. The editor refreshes its saved baseline from the detail response, keeps the verified module save open on Administrator access, and explains read-only mode. Administrative API requests also pass through session refresh middleware.

After migration/deployment:

1. Sign in as Super Admin and open Businesses.
2. The **Your ERP workspace** panel identifies the Super Admin's own organization. Choose **Manage my modules**, enable desired modules (or Enable all), and save. Keep the business active and its subscription valid.
3. A Super Admin already has all user permissions: an administrator grant is not required for that role. **Open my ERP workspace** opens normal ERP operations for the Super Admin's own business. This never switches into another tenant. Other businesses' Open Workspace remains read-only inspection.
4. For a normal business administrator, save that business's modules, then use **Grant enabled-module access**. Refresh the administrator's workspace. The grant button stops reporting missing Manufacturing/Farm Services access once those permissions are assigned.
5. Toggle Farm Services on/off for an older business and reopen Module Access; the saved selection must persist. Disabled modules and suspended/expired businesses must still reject operations even when permissions remain on the profile.

Relevant checks: `tests/business-admin-access-database.mjs`, `tests/business-access-database.mjs`, `tests/platform-business-editor.cjs`, `tests/platform-business-api.cjs`, `tests/business-access-navigation.mjs`, `tests/session-access-regression.cjs`, focused ESLint and `npm run build`. Database tests use the explicitly configured isolated PGlite fixture; no remote migration or business data is touched. Real authenticated Preview testing remains necessary after applying 059.
