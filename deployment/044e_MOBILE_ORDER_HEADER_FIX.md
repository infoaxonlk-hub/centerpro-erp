# CenterPro Update 044e — Purchase mobile header alignment

## Fix
- On the order toolbar, the `Purchase view` label remained visible because the general `sr-only` class was not styled in this screen. The order reference and controls collided in mobile layouts.
- Added a scoped visually-hidden label style so the view select retains its accessible name without occupying visible space.
- Aligned the order reference and toolbar actions using two grid columns. Truncates overly long references; provides a narrow viewport fallback for tiny screens.
- Preserves order number, draft menu, POS/Detailed selector, new draft button, Payment Window and Labor Session functionality.

## Apply (Testing feature branch only)
1. Confirm `git status --short` is clean.
2. Extract ZIP at the root of the local CenterPro-testing repository, overwrite files.
3. Run `node tests/purchase-order-bar-responsive-044e.cjs` and existing purchase regression tests.
4. Run `npm run build`; do not push if it fails.
5. Commit and push current feature branch, verify Vercel Preview (narrow phone sizes, draft switching, long order numbers).

**No Supabase SQL migration.** Payment, inventory, draft IDs, and data logic unchanged.
