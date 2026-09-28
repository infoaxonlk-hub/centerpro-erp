# Stock scrap update

Adds a stock scrap screen for center users and stock-enabled administrators.

## Install

1. Run `supabase/migrations/030_stock_scrap.sql` in the existing Supabase project's SQL Editor.
2. Copy the files in this update into the repository root, preserving the shown folder paths.
3. Run `npm run build` and push the changes to the intended branch.

Center users can scrap stock only at centers they are assigned to. A scrap record requires an active location, available quantity, and a reason. Confirming creates a stock movement, updates the inventory balance immediately, and records the scrap history and audit entry.

Open **Operations → Scrap stock** to use the screen. The page is also linked from the inventory navigation. Admin users need stock permission.
