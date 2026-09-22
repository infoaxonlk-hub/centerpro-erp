# Remember last selling price

The sales POS now remembers the last **confirmed** selling price for each center + product quality.

- First sale with no saved price: the seller enters the price manually.
- After the sale is confirmed: that entered price becomes the saved default.
- Next sale: selecting the same product/quality auto-fills the saved price.
- The seller can still change the price for the current sale.
- The changed price becomes the new default only after that sale is successfully confirmed.
- Different centers keep their own last selling price.
- Existing sale history is used to backfill the newest confirmed selling price when migration 020 is applied. Old admin-entered price-list values are cleared so they cannot become defaults accidentally.

## Deployment

1. Deploy this code.
2. Run `supabase/migrations/020_remember_last_sales_price.sql` in the Supabase SQL Editor after migrations through 019.
3. Open **Sales > New Sale** and verify a product with previous sales shows `Last price` and auto-fills it when added.

The existing `sales_prices` table is reused as the remembered-price store; no separate admin-maintained selling price is required.
