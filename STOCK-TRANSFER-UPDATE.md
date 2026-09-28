# Internal Stock Transfers

This update adds an inventory transfer page for moving stock between locations in the same center or between centers.

## What it does

- Shows positive stock available at the chosen source location.
- Lets the user select one or more product qualities and quantities, then select a destination center and location.
- Rejects transfers to the same location and rechecks current source stock in the database before posting.
- Posts paired `transfer_out` and `transfer_in` movements together, so source stock decreases and destination stock increases atomically.
- Moves stock value at the source location's current weighted average cost, and keeps a transfer number/history.
- Uses existing `stock` module and center access: a center user can transfer between centers only when they have access to both; admins can choose the active organization centers available to their account.

## Install and deploy

1. Run `supabase/migrations/029_internal_stock_transfers.sql` in the Supabase project used by the deployment you are testing.
2. Extract this ZIP into the root of the local `CenterPro-testing` repository folder. Keep the `app`, `components`, and `supabase` folders at the repository root.
3. Run `npm run build`.
4. Review `git status --short` before staging. Keep any unrelated local edits separate.
5. Commit and push to the testing branch/deployment first. After testing, merge the approved changes to the pilot branch and deploy it there.

The Vercel `main` deployment in the current workflow is the testing deployment; do not treat it as the live pilot deployment. Use the existing pilot Supabase project for the pilot deployment, since the project limit prevents creating another database.
