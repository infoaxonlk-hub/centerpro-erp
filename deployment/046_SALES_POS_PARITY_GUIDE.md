# CenterPro 046 — Sales POS / Detailed Sales and Multi-Drafts

## What changed

- Added **POS / Detailed** view selector to Sales > New Sale, matching the compact Purchase Order draft bar.
- Added **Hold & New**, Resume previous sales drafts, draft count, and device-only temporary D-xxxx references.
- Stored per-sale draft Customer, Center, Items, Quantity, Stock Location, Selling Price, Payments, Notes, Labor Session, Checkout state and requestId.
- Added mobile-friendly **Detailed Sales Order** with customer selection, quick customer creation, product/category/quality search, live location stock, quantity, last confirmed selling price and manual price editing.
- Reused the **same Sales checkout** for both views: customer, labor session at payment only, Cash/Credit/Bank Transfer/Card/Cheque split payments, draft bill and confirmed sales invoice.
- Preserved existing `sales_stock` lookup, `confirm_center_sale_with_labor` RPC, server-enforced stock-out rules, customer credit, sales receipt, cached-stock/offline queue behavior.
- The Sales flow does **not** copy Purchase-specific Farmer, Supplier Payable, Center Cash Out, or Sack Count data, as Sales `sales_order_lines` does not currently persist sack count.

## Deployment

1. Work on `feature/centerpro-cash-039-040`, not `main`.
2. `git apply --check "$HOME\\Downloads\\CenterPro_046_Sales_Parity.patch"`
3. `git apply "$HOME\\Downloads\\CenterPro_046_Sales_Parity.patch"`
4. `node tests/sales-parity-046.cjs`
5. `npm run build`
6. After passing locally, commit and push feature branch, verify Vercel **Preview** before merging to `main`.

**No SQL migration required** for this UI update. Existing Sales migrations and RPCs must already be in place. Do not run deferred 040 SQL as part of this patch.

## Essential real-use Preview checks (both 375px mobile and desktop)

1. Existing in-progress sale reopens under D-0001, including items/payment/customer.
2. Select Detailed; enter customer and products, choose quality, stock location, positive qty and selling price. Out-of-stock or too-high quantity cannot be confirmed.
3. Hold current sale via `+`, create another sale, return to previous via the drafts icon. Verify each order retains unique customer, cart, price and payments.
4. Switch POS ⇄ Detailed without losing cart. Refresh and check preferred view remains selected.
5. Complete Cash sale; check stock decreases *once* and invoice prints from sales receipt page.
6. Complete split Cash + Credit sale to a saved customer; verify paid and receivable balances.
7. Test bank/card/cheque required account fields, labor session only in Payment window and Draft Bill before confirmation.
8. Offline test with cached stock: queue sale, create new draft, reconnect. Ensure sync of one sale does not discard a different draft. Test multi-device behavior: drafts are **browser-local only**.

Note: Static regression tests check code contracts, not live Supabase data or browser behavior. Manual end-to-end testing is required for any production rollout.
