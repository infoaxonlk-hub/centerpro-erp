Apply `supabase/migrations/049_product_sack_tracking.sql` in Supabase before testing this version. The migration is transactional and follows 048. Existing products default to **Track sack counts: No**.

In Products & Suppliers, create or edit a product and set **Track sack counts** to **Yes**. Adding that product to a purchase automatically opens Detailed entry. The view remains locked while a tracked product is in the purchase. Each tracked weight row requires a positive whole sack count. Other products can still use POS; mixed detailed purchases accept zero sacks for untracked rows. The setting does not change the product's weight unit or price calculation.

For tracked products, sales, internal transfers and scrap require a whole sack count. Enter **0** for loose stock moving without sacks. The database rejects negative sack stock and rolls back the entire operation, including weight and financial posting. Returns cannot exceed the source line's remaining sacks; approved returns and cancellations reverse the appropriate sack movement. Retries do not post sack movements twice.

Stock cards and the detailed stock table show sacks alongside weight. Transfers and sales show available sacks. Dashboard → Business summary includes the recorded sack total; the dashboard now contains only that summary.

Historical movements did not record sack outflows, so the migration does not guess an opening balance from kilograms or old purchases. After enabling tracking on an existing product, use **Stock adjustment** at each location and quality to enter the current physical weight and sack count. The weight can stay unchanged while correcting only sacks. **Opening sack count needed** means no sack count has yet been recorded for that stock balance.

New sack ledger reads preserve organization, center, subscription, module and user permission boundaries. Direct client ledger writes and internal helper execution are denied. Existing purchase/sale financial procedures and their guards are retained.

Validation: `node tests/product-sacks-database.mjs` with `PGLITE_MODULE` pointing to an installed PGlite module runs migrations and isolated purchase, sale, transfer, count, return, cancellation, scrap, retry and tenant tests. It never connects to production.
