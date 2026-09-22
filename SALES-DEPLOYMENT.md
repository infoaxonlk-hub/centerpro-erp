# CenterPro Sales base release

## Deployment

This ZIP contains the complete source, including existing expense, branding and dashboard-card updates. Keep your existing environment configuration.

1. Extract the ZIP at your Codespaces repository root. Back up your repository and database before production deployment.
2. In Supabase SQL Editor, run the complete **017_sales_module.sql** file. Wait for Success. Run **018_sales_workflow.sql** separately after that. Both are in supabase/migrations/. Do not combine these runs: PostgreSQL requires new enum values to be committed before use.
3. Build, commit and push. Wait for Vercel deployment success, then refresh.

Requires prior migrations 001–016. Do not rerun older migrations against a live database. The unfinished Sales migration shown in the earlier conversation was never included in a released ZIP; use only this version. If a custom/partial Sales migration was already manually run, stop and reconcile that schema before applying 018.

## First use

- Sales → Selling prices (admin): choose a center and set each product-quality selling price.
- Sales → Customers: create center-owned customers, or use Walk-in for non-credit sales.
- Sales → New sale: select center, product-quality, location and quantity, then payment allocations.
- Cash starts at the full total; edit it and Add payment line to allocate the remainder.
- Credit requires a named customer. Bank Transfer, Card and Cheque require an active bank account; Cheque also requires number and date.
- Confirmation posts stock-out at stock cost, records non-credit sales payments separately from purchase payments, adds only Cash to the center cash ledger, and creates a customer receivable for Credit.
- History & reports provides center/date/customer/method filters, item/center/payment summaries and customer credit totals. Click a sale number to view or reprint its stored receipt.
- New Sales permission is exposed in Users. Existing admins and purchase-enabled staff receive Sales access in migration 018; center assignment restrictions still apply. Other staff receive no new access.

## Scope

This is the agreed base release. Returns, discounts, customer credit limits, receivable settlement, incoming-cheque clearing/reminders and tax invoicing are not included. Sales cheques appear on sales receipts and in sales reports; existing Cheque Management remains for purchase/outgoing cheques. The paid figure follows existing tender-allocation semantics, not bank clearance.

## Validation performed

- Production Next.js build and TypeScript compilation.
- New Sales module lint checks.
- All migrations 001–018 run against an isolated in-memory PostgreSQL (PGlite) database, with Supabase auth functions simulated.
- Tests cover split Cash/Credit, receivables, exact totals, duplicate request idempotency, stock cost, stock-out, repeated cart quantities, rollback, bank/cheque validation, cross-center/cross-organization access, inactive users and Sales permission checks.
- No live Supabase writes or authenticated production browser tests were performed.

Test source: tests/sales-database.mjs. Install @electric-sql/pglite in a separate test directory and set PGLITE_MODULE to its dist/index.js, then run node tests/sales-database.mjs. It never connects to production.

## Production smoke test

Use a test center with known stock. Confirm a small Cash/Credit split sale. Verify stock reduction, cash increase, credit balance, receipt reprint, and that another center user cannot open the receipt. Verify a blocked insufficient-stock sale changes neither stock nor payments.
