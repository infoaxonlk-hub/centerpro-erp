# Sales and Purchase Returns

This update adds partial returns linked to an existing confirmed sales invoice or purchase bill.

## Return behavior

- A user with Sales or Purchases access can submit a return request from the bill details.
- The app prevents requesting more quantity than remains unreturned. Pending requests count against that quantity.
- An admin or super admin reviews the request under **Return Requests**.
- Approval returns sale items to stock, or removes purchase items from stock. Purchase returns are rejected if the center no longer has enough stock.
- The return value reduces the original bill's unpaid balance first. Any excess is saved as an unapplied credit note owed to the customer or supplier; no cash refund is made automatically.
- Cancellation is blocked while a return request is pending or approved, to prevent reversing the same stock twice.

## Install on the main branch

1. In Supabase, open the database project connected to the `main` branch and open **SQL Editor**.
2. Paste and run the full contents of `supabase/migrations/028_sales_purchase_returns.sql` once.
3. Extract this ZIP into the local repository folder, allowing it to replace the listed files.
4. In PowerShell, go to the repository and run `npm run build`.
5. If the build succeeds, commit and push the files to `main`; Vercel will deploy from that branch.

## Note

Unapplied credit notes are recorded and shown in the Return Requests page. This update does not apply one credit note to a later, different bill or record a cash refund.
