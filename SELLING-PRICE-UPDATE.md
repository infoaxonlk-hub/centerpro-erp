# Seller-entered selling prices

The center seller enters a positive selling price on each cart line. There is no required admin price list; the former Selling prices setup tab is removed. New lines start with an empty price. Checkout requires a valid price with at most two decimal places. Existing sales retain their stored prices.

Sales > History & reports > Actual selling prices shows the confirmed unit price, quantity and amount per line, respecting center, customer, date and payment filters. Stored receipts continue to show actual unit prices. Center access and stock/payment validation remain enforced by the database.

Deployment: extract this release, then run supabase/migrations/019_sale_entered_prices.sql in the Supabase SQL Editor before using the new POS. Requires migrations through 018 already applied. Build, commit and push the code after migration success.

Verified: production build, ESLint, isolated component checks and in-memory PostgreSQL tests covering seller-entered prices without a configured admin price, invalid prices, stock, payments, rollback, idempotency and center/organization isolation. Live production and physical printer tests were not performed.
