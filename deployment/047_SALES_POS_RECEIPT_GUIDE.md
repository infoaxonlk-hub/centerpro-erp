# CenterPro Update 047 — Sales POS Receipt Preview

## What changes

- Confirmed online Sales POS transaction opens the **Sales POS Receipt** screen rather than the large Sales Invoice Details page.
- Sales that finish offline syncing use the **same** persisted receipt route; no duplicate payment or stock posting.
- Receipt is shown on-screen in a compact 80 mm thermal-paper style, using the existing standard Bill renderer and English/Sinhala language toggle.
- No auto-print. Print dialog opens only after selecting **Print receipt**.
- Receipt actions are shown in this order: **Print receipt → New sale → Request return → Request cancellation**.
- Original sales/order/payment rows and `sales_invoices` / customer receivables are not changed. For credit sales, customer balance and a link to Receivables remain available.
- The displayed bill number uses the actual sale number, not the accounting invoice number.
- No SQL migration. Do not apply migration 040 as part of this update.

## Safe installation

On `feature/centerpro-cash-039-040` with a clean working tree:

```powershell
Expand-Archive -LiteralPath "$HOME\Downloads\CenterPro_047_Sales_POS_Receipt.zip" -DestinationPath "$HOME\Downloads\CenterPro_047_Patch" -Force

git apply --check "$HOME\Downloads\CenterPro_047_Patch\CenterPro_047_Sales_POS_Receipt.patch"

git apply "$HOME\Downloads\CenterPro_047_Patch\CenterPro_047_Sales_POS_Receipt.patch"

node tests/sales-receipt-047.cjs
node tests/sales-parity-046.cjs
npm run build

git diff --check
git status --short
```

**Important:** Run one step at a time and stop on errors. The Git patch does not modify the real Supabase database. No `main` push is needed during preview testing.

## Manual Preview QA

1. Validate a **fully paid cash** sale. The result should be a centered receipt, not an invoice dashboard, with correct paid and zero credit balance. Click Print to inspect an 80 mm receipt.
2. Validate **split payment** (e.g. Cash + Bank/Card). Every payment line must appear with correct amounts.
3. Validate a **credit or partially paid sale** with a customer. Receipt must show paid amount, credit balance and status; Receivables remains accessible.
4. Check the four buttons order, and ensure Request return/cancellation dialogs still function appropriately.
5. Check English / Sinhala toggle, desktop and 320px / 375px / 430px mobile layouts.
6. Open an older order from Sales Orders; it should show the same POS receipt preview.
7. Verify the offline sync flow opens the same receipt after a transaction has been posted, without double charging.

## Rollback

Before committing, use `git apply -R "...\\CenterPro_047_Sales_POS_Receipt.patch"` to reverse the patch if there are no further edits. Do **not** reset unrelated working changes.
