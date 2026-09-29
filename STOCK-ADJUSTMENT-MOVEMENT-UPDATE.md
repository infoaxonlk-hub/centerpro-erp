# Stock adjustment and product movement history

- Inventory / Stock → Stock adjustment: select center, location, product and quality; enter the physical count and reason. The database calculates the difference under a center row lock, writes one stock movement and an audit record. Adding stock from zero asks for a unit cost.
- Inventory / Stock → Product movements: choose a product to inspect its dated purchases, sales, transfers, returns, scrap and adjustments. Stock explorer product names link directly to the history. Records are paginated at 50 and restricted to centers the logged-in user can access.
- Users need the `stock` permission. The adjustment RPC verifies access and active product/location, and uses a request UUID to prevent duplicate entries.

## Apply to the testing project on `main`

1. Extract this archive into the root of `C:\Users\banda_8k3w5n5\Downloads\CenterPro-testing`, preserving folders and replacing matching files. Ensure the current branch is `main` and the working tree was clean beforehand.
2. Run `supabase/migrations/032_stock_adjustments.sql` **once** in the testing Supabase project's SQL Editor. Verify `Success`.
3. Run `npm run build`.
4. Run `git status --short`, then `git add app/dashboard/stock/adjustments app/dashboard/stock/movements app/dashboard/stock/stock-view.tsx app/dashboard/stock/stock-chart.css components/sidebar-navigation.tsx supabase/migrations/032_stock_adjustments.sql STOCK-ADJUSTMENT-MOVEMENT-UPDATE.md`.
5. Run `git commit -m "Add stock adjustments and product movement history"` and `git push origin main`. Wait for Vercel production deployment to become Ready.
6. Verify an adjustment in a testing center; check the balance and the product history. Test both an increase and a decrease. The pilot branch/database are separate and are not updated by these steps.
