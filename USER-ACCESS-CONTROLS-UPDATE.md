# User access controls and Users view

- The Users page uses readable cards with wrapped permission labels, center assignments and status.
- Admins can edit a saved user's name, phone, role, center assignments and module/action permissions. Email and password have separate handling. The Super Admin remains protected.
- Granular permissions: `product_create`, `product_edit`, `stock_adjustment`. The UI auto-includes `masters` for product actions and `stock` for stock adjustment. Product price changes, quality setup, category setup, CSV import and supplier management remain admin controlled.
- Migration 033 enforces the new controls in RLS and RPCs. Run it only after migration 032 is present. A user with Stock access alone cannot submit a stock adjustment.

## Apply to `main` (testing project)

1. In PowerShell, `cd "$HOME\Downloads\CenterPro-testing"`; `git switch main`; `git pull --ff-only origin main`; `git status --short`. Start with a clean tree.
2. Extract the ZIP into the repo root, replacing matching files.
3. In the **testing Supabase project**, run `supabase/migrations/033_granular_inventory_user_access.sql` once in SQL Editor. Migration 032 must already have succeeded.
4. Run `npm run build`.
5. Run:

   `git add app/api/admin/users/route.ts app/dashboard/users/page.tsx app/dashboard/users/users-manager.tsx app/user-access.css app/dashboard/masters/page.tsx app/dashboard/masters/masters-manager.tsx app/dashboard/stock/page.tsx app/dashboard/stock/stock-view.tsx app/dashboard/stock/adjustments/page.tsx components/sidebar-navigation.tsx lib/access.ts supabase/migrations/033_granular_inventory_user_access.sql USER-ACCESS-CONTROLS-UPDATE.md`

   `git commit -m "Add granular user access and improve Users view"`

   `git push origin main`

6. Once Vercel is Ready, sign in as admin, edit a center user and enable View products, Create products, Edit products, and Stock adjustment as needed. Sign in as that user and verify allowed actions. Disable each right and verify its action is no longer available.

The pilot branch and database are unaffected until deliberately updated.
