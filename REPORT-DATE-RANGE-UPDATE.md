# Report date ranges

This archive also contains the stock adjustment and product movement update from the preceding release, so it can be applied directly if that archive has not yet been installed.

New From/To date filters:
- All Payments and Bank Transactions: filters totals, method breakdowns, center/bank summaries and rows by transaction date. Presets remain available. Selecting a custom date switches to All Time before applying the custom bounds. Current available cash remains a current balance, not a historic balance.
- Customer Receivables and Supplier Payables: filters bills by creation date, the count and sum. Outstanding amounts reflect the current due, not a past snapshot.
- Stock FSN: filters sale movement dates, including sales returns. Current on-hand stock stays current. Period presets apply when the custom dates are blank.
- Product movement history, internal stock transfer history, scrap history and Audit: server-side date bounds use the Asia/Colombo calendar. Audit and product movements retain paging.

Purchases, Sales, Expenses and Cheque Management already have From/To date fields; their report totals and rows follow those controls. Expense loading now pages past the former 300-row cap; payment summary loading pages past the default database API limit.

## Apply to the testing environment on `main`

1. In PowerShell: `cd "$HOME\Downloads\CenterPro-testing"`; run `git switch main`, `git pull --ff-only origin main`, and `git status --short`. Start with a clean working tree.
2. Extract this ZIP into that folder, preserving directory structure and replacing matching files.
3. If migration `032_stock_adjustments.sql` was **not** run with the preceding update, run it **once** in the testing Supabase SQL Editor. If it was already run, do not rerun it. This date-range update has no new SQL migration.
4. Run `npm run build` and check it succeeds.
5. Run `git add app/dashboard/audit/page.tsx app/dashboard/expenses/page.tsx app/dashboard/payment-reports/report-screen.tsx app/dashboard/payment-reports/split-report.tsx app/dashboard/stock app/report-date-ranges.css components/credit-ledger.tsx components/sidebar-navigation.tsx lib/report-dates.ts supabase/migrations/032_stock_adjustments.sql STOCK-ADJUSTMENT-MOVEMENT-UPDATE.md REPORT-DATE-RANGE-UPDATE.md`.
6. Run `git commit -m "Add stock adjustment and report date ranges"`, then `git push origin main`.
7. Once Vercel is Ready, verify same-day and multi-day ranges in Payments, Receivables/Payables, Audit and Stock FSN. Then test a product adjustment if step 3 was newly applied.

This update does not merge or deploy the pilot branch.
