# CenterPro 039 – Admin / Center Cash Accounts (Safe Rollout)

## Scope
- Created automatically: one **Admin Main Cash** per organization, one **Center Cash** per center, and technical **Cash In Transit**, **Cash Activity Clearing**, **Cash Difference Control** accounts.
- Current accounts, centers, users, products, transactions, cash ledgers, expenses, receipts are **not deleted**.
- Migration 039 builds a read-only-to-browser balanced journal. Each journal row records one equal debit and credit. Existing cash-ledger entries are mirrored, so old physical center balances carry forward without inventing new cash deposits.
- New centers automatically receive a cash account.
- Admin/Super Admin can add cash to Admin Main and issue for receipt. Admin or assigned Center User can confirm receipt. If the amount differs, a reason is mandatory and the variance is recorded separately.
- Purchases **and** cash expenses use the same available center cash account. Previous purchase/expense receipt allocations remain for traceability, but they do not make two physical center accounts.
- Legacy pending purchase and expense cash handovers remain accessible and receivable. The old **new issue** and **new direct center top-up** endpoints are blocked to prevent bypassing Admin Main.
- This is a **cash-only double-entry subledger**, not full statutory double-entry accounting. Bank withdrawal on Admin Cash In is a source label, **not** a bank-account debit. VAT/SSCL and complete general-ledger posting are outside migration 039.

## FIRST: Testing rollout

1. **Confirm the database** in Supabase. You need the **testing** project, NOT the `collectpro` Production DB (unless that is intentionally the testing DB). Verify project URL from Vercel `NEXT_PUBLIC_SUPABASE_URL`.
2. **Make a restorable database backup/snapshot** for this testing project, and separately save any important data. Do NOT run the earlier transaction-reset SQL for this change.
3. Verify all migrations through `038_product_images.sql` were applied (especially `015_expense_management.sql` and `031_unified_cash_float.sql`). This update expects them; do not blindly rerun older migrations.
4. In Supabase SQL Editor, run `supabase/migrations/039_cash_accounts_double_entry.sql` **as one query**. Wait for `Success`. If an error appears, STOP and provide the exact error. It is wrapped in `BEGIN/COMMIT`; on an SQL error the transaction rolls back.
5. Run `deployment/039_verify_cash_accounts.sql` as a separate query. Its queries are read-only. Check that the **second, third and fourth** result sets are empty. If historical balances do not match, STOP before deploying the code.
6. Create a *testing Git branch* and apply the patch ZIP to the project root, preserving folder layout. Example Windows PowerShell:
   ```powershell
   git switch -c feature/cash-accounts-039
   Expand-Archive -LiteralPath "$HOME\Downloads\CenterPro_039_Cash_Patch.zip" -DestinationPath . -Force
   npm ci
   npm run build
   git status --short
   git add app components supabase deployment
   git commit -m "Add balanced admin and center cash accounts"
   git push -u origin feature/cash-accounts-039
   ```
   Run the build in your **own machine**: this delivered archive has had TypeScript syntax checked, but cannot be marked production-ready without a successful **full Next.js build** and Supabase DB tests.
7. Deploy the **testing branch** in Vercel, ensuring the Vercel environment points to the SAME Supabase testing project in which 039 ran. Refresh browser; sign in as Admin and Center User.

## Required functional UAT on TESTING

A. **Create a new center**: one center cash account appears, starting with LKR 0.

B. **Admin cash in**: add genuine LKR 1,000 as an owner contribution. Admin Main should increase by LKR 1,000; Cash In history shows source.

C. **Issue LKR 600** (LKR 400 purchase + LKR 200 expense) to a chosen center. Admin Main decreases by LKR 600; Cash In Transit increases LKR 600; center does **not** increase yet.

D. **Log in as center user with that center assigned**: see ONLY their center account; pending receipt shown. Confirm 400 + 200. Center Cash increases by LKR 600; Cash In Transit returns to 0.

E. Purchase LKR 100 cash and record a LKR 50 cash expense. Center Cash should be LKR 450 (assuming it started at 0). Purchase, expense and cash pages must agree.

F. Issue another LKR 100 and receive only LKR 90, giving a written shortage reason. Center increases 90, Transit clears, Cash Difference Control records 10, and Admin can see the reason.

G. Negative tests: issue more than available Admin Main (rejected); purchase/expense more than Center Cash (rejected); try a center user's view of Admin Cash (not visible); try duplicate receipt (rejected); attempt legacy issue (rejected).

**Note:** These are example amounts. Do not re-enter real historic balances as Cash In just to match the old records; old center ledger balances have been carried forward automatically. If Admin Main is initially zero, that can be correct: older legacy issues are historical and are not falsely backfilled as new Admin funding.

## Production rollout — ONLY after testing passes

1. Schedule a quiet maintenance window; stop users from issuing cash/creating purchases/expenses during the change.
2. Create and verify a **restorable production backup** first. Record original center balances and existing pending handovers.
3. Confirm the target Supabase project is the correct **production** project. Take note of its project ref and Vercel environment URL; do NOT confuse `collectpro_testing` and `centerpro_original`.
4. Run the **same migration 039** on PRODUCTION via SQL Editor. If ANY error, stop; do not change/disable FK constraints, do not add CASCADE, and do not deploy the new UI.
5. Run verification script 039 on PRODUCTION; reconcile center balances. If result sets 2–4 contain rows, STOP. If existing data have a negative center cash balance, investigate before accepting new cash spends.
6. Merge the approved testing Git branch into the intended production branch. Build again (`npm ci` + `npm run build`) and deploy it on the production Vercel project. Confirm it uses the production Supabase URL and keys; keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
7. Smoke test on PRODUCTION with a legitimately small Cash In and receipt, or verify historical read-only first; do not invent deposits to test. Verify permissions by logging in as one actual center user.
8. Reopen cash operations only after Admin Cash In, transfer, receipt, center balances, purchase/expense spending, and audit/history all work.

## Rollback / failure notes

- Migration 039 is additive and transaction-wrapped; errors **during** its SQL run roll back that SQL transaction.
- After migration 039 succeeds, **do not** try to rollback by deleting journal rows or running transaction-clear queries. Take a backup and coordinate a proper repair/reversion if post-deployment data must be recovered.
- Rolling back only Vercel to the old UI may expose disabled legacy issue functions. Keep the new feature disabled for users until tested, or apply an intentionally designed rollback migration.
- No live Supabase database or production deployment was accessed while preparing this patch. A local, complete `npm run build` could not be verified in this environment. Your own test and acceptance are required.
