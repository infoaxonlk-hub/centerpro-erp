# Seller-entered selling prices with remembered defaults

The center seller can enter a positive selling price on each cart line. There is no required admin-maintained selling price list.

The POS now remembers the **last confirmed selling price** for each center + product quality:

- If no remembered price exists, a new line starts with an empty price.
- After a sale is confirmed, its entered selling price is saved as the remembered default.
- The next sale auto-fills that remembered price when the same product/quality is added.
- The seller can change the auto-filled price for the current sale.
- A changed price becomes the new default only after that sale is successfully confirmed.
- Each center keeps its own remembered price.

Checkout still requires a valid positive price with at most two decimal places. Existing receipts and sales history continue to retain the actual price used on each sale.

Sales > History & reports > Actual selling prices shows the confirmed unit price, quantity and amount per line, respecting center, customer, date and payment filters. Stored receipts continue to show actual unit prices. Center access and stock/payment validation remain enforced by the database.

## Deployment

Run migrations in order through `020_remember_last_sales_price.sql`. Migration 020 converts the old `sales_prices` storage into remembered seller prices: old manual/admin setup values are cleared, then the newest confirmed sale price is backfilled where sales history exists.

Then build, commit and push the code after migration success.
