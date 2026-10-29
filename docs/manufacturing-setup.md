# Manufacturing integration

Imported from `centerpro-erp-development-manufacturing-final.zip` into the existing `development` checkout. Only the manufacturing directory, migration 052 and the four related shared application files were imported. Existing environment files, dependencies, purchases, sales, stock features and earlier migrations were retained. No remote migrations, pushes or deployments were performed during setup.

## Available features

- Manufacturing workspace, own/external milling, actual main/by-product outputs, packing runs, and reusable recipe operation/rate defaults.
- Saved drafts can be reopened through the order list. Completed orders show their output lots and cost snapshots.
- Milling consumes selected source lots or the existing oldest-available allocation. Packing consumes bulk rice and packaging materials and checks the rice variety, whole bag counts and packed weight.
- Output stock uses the existing lot registry and physical stock ledger. Inventory views include production movements even when the Manufacturing licence is subsequently disabled. Purchase receipt history and existing costing policy behavior are preserved.
- Sack-tracked inputs and outputs have explicit sack fields; zero represents loose stock. Stock and sack posting share the completion transaction.
- Drafts use stable client-generated IDs. Repeated saves/completions do not create duplicate orders, stock movements or output lots. Completion rechecks stock and selected lot availability after each input, and rolls back the whole posting on failure.
- Manufacturing permission is available under Users & Access and accepted by the user API. The supplied ZIP's compatibility rule is retained: stock users can use Manufacturing when the business has that module enabled. Business licensing, subscriptions, tenant boundaries and assigned centers are enforced.

## Database steps for the operator

1. Run the ZIP's `052_manufacturing_module.sql` once after migration 051. Its contents are unchanged from the archive (SHA-256 `4C9BBCEBF11FD565530528E8E4BAA550820DF4CD095D46EDA58E16D41632972F`). If already applied, do not rerun it.
2. Run the complete **`supabase/migrations/053_manufacturing_integration_fixes.sql`** once. This follow-up fixes an ambiguous SQL variable that prevented completion, double-signed quantity/cost calculations, repeated source-lot overdraw, stock permission compatibility and retry behavior. It also connects sack posting and the administrator permission grant.
3. Refresh the API schema:

```sql
notify pgrst, 'reload schema';
```

4. As super admin, enable **Manufacturing** for the business under Manage modules. Its parent **Inventory** must also be enabled. Manufacturing is not automatically licensed for existing businesses. Use the existing admin-access grant action or Users & Access to grant the module to the intended operator, and assign their center if applicable.

## Verification

```powershell
Set-Location 'D:\Infoaxon\Project\centerpro-erp'
git switch development
$lotTestRoot = Join-Path $env:TEMP 'centerpro-lot-tests'
npm install --prefix $lotTestRoot --no-save --package-lock=false @electric-sql/pglite@0.5.11
$env:PGLITE_MODULE = Join-Path $lotTestRoot 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/manufacturing-database.mjs
node tests/manufacturing-ui.cjs
node tests/product-defaults-lot-balances.mjs
node tests/purchase-lots-database.mjs
node tests/product-sacks-database.mjs
node tests/business-access-database.mjs
node tests/navigation-regression.cjs
npm run build
```

Database tests use isolated embedded PostgreSQL databases. The manufacturing regression covers milling, external fees, packing/packaging, costs after prior outbound movements, same-lot overdraw rollback, sack counts, retries, tenant/center access, manufacturing-only operators and inventory access without a Manufacturing licence.

Manufacturing is an online workflow; it does not add an offline production queue. Recipes in the supplied module are operation/rate defaults, not material-line templates. External mill fees contribute to production costs; they do not automatically create supplier payments or accounting journals. Existing unit-cost rounding remains in effect. Stock that predates lot allocation remains Unassigned / Legacy; historical lot allocation is not invented.
