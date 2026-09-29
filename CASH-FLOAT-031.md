# CenterPro combined cash flow (migration 031)

Apply the included files over a local checkout that has all migrations through 030. Build, then run `supabase/migrations/031_unified_cash_float.sql` in the **testing** Supabase project's SQL Editor before testing the app. Do not run this migration on the pilot database until the testing flow has been verified.

Admin Cash & Payments now records owner cash, bank withdrawal, or other sourced cash in the admin float. A single issue can include separate purchasing and expense amounts. The total must fit the available admin float. The center enters actual received purchasing and expense amounts in one receipt. The center sees the issued amounts and a generic mismatch warning; the admin sees the exact difference in the reconciliation table. Cash balances are posted only when the receipt is submitted. Historical separate purchasing and expense handovers remain in their legacy lists for previously pending transactions.

The admin float starts at zero. Old center balances and handovers are displayed but are not backfilled as new admin Cash In records. Enter a genuine funding amount before issuing from the new flow; do not duplicate prior balances. Bank withdrawal is a source label/reference here, not an automatic bank-account debit.
