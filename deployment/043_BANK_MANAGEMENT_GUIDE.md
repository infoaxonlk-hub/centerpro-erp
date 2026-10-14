# CenterPro 043 — Cash Manage + Bank Management

**Target:** `feature/centerpro-cash-039-040` branch of CenterPro Testing (`origin` remote `infoaxonlk-hub/13244793`).

## Included UI
- **Cash Manage** → Cash Management; Cash Ledger. Existing cash posting logic unchanged.
- **Bank Management** (Admin/Super Admin only) → Bank Accounts (create account, Add Bank Funds), Bank Statement.
- One `bank_accounts` row per organization, bank and account number; no duplicated bank accounts per center. Purchases/sales at any center post into that shared account.
- Debit = bank money in; Credit = bank money out. Statement displays center, transaction type/bill reference and **company-wide** running balance. Center filter only filters visible rows (does not recalculate full balance).

## Payment mapping
- Sale **bank transfer** → bank debit (funds received).
- Purchase **bank transfer** and purchase **card charge** → bank credit (funds paid).
- Sale **card** settlements, **cheques** (in/out) are **not** automatically banked until settlement/clearance is implemented in a future phase. **Do not** treat uncleared cheques as available bank money.
- Existing `payments` and `sales_payments` rows with bank-account IDs are backfilled once; unique source keys prevent replay duplication.
- Each bank-side entry creates an equal, opposite control posting in `bank_book_contra_entries`, forming a balanced bank subledger. This does not replace full accounting/GL, VAT, or bank reconciliation.

## Prerequisites / safety
1. Verify Preview deployment currently runs approved Update 042 and uses your **Testing Supabase** database. **Do not use production** first.
2. Take a **restorable Supabase backup**. Record `bank_accounts`, `payments`, `sales_payments` row counts and existing bank balances.
3. Confirm migration **039** is applied, the 042 Cash Ledger works, and bank accounts already created are genuine.
4. Confirm `043_bank_management_and_statement.sql` is the same migration supplied with this patch. **Never blindly rerun old migrations.**
5. This SQL does not delete data, but it DOES introduce bank-book rows from past payments. Prior cancelled/non-cash transactions may need manual reconciliation. See verification query #5.

## Step A: Run Supabase SQL (Testing only)
1. Supabase → Testing Project → SQL Editor → New query.
2. Paste `supabase/migrations/043_bank_management_and_statement.sql` and Run. Expect Success.
3. Run `supabase/migrations/043_verify_bank_management.sql` **query by query**. Queries 2 and 3 should return **no rows**. Queries 4 and 5 are manual-review alerts, not automatically errors.
4. Query 1 lists book balances; these can be **negative until a verified opening balance** is posted. Do not enter random amounts just to make them positive.

## Opening balance warning
Historical bank transfers are backfilled with their **original dates**. To make the current statement match the bank, determine the true opening balance **immediately before the earliest imported movement**. In Bank Accounts → Add Bank Funds, select `Opening balance before imported transactions` and specify an earlier **posting date**. If accurate opening balance cannot be established, stop and reconcile with actual bank records rather than entering today's bank balance (which would double-count historical transactions). If the source is an actual owner contribution or external deposit, record it only once on its actual date. Do not re-enter POS bank payments with Add Bank Funds. A cash-to-bank transfer requires corresponding cash-book credit; this patch does not automate those cross-ledger transfers.

## Step B: Apply code patch
In Windows PowerShell, inside `CenterPro-testing`, while on the feature branch, with a clean working tree:

```powershell
git branch --show-current
git status --short
Expand-Archive -LiteralPath "$HOME\Downloads\CenterPro_043_Bank_Management_Patch.zip" -DestinationPath (Get-Location).Path -Force
node tests/cash-navigation-ui-041.cjs
node tests/cash-ledger-042.cjs
node tests/bank-management-043.cjs
npm run build
```

If all tests + build pass:

```powershell
git add app/dashboard/bank app/dashboard/cash/unified-cash.tsx app/dashboard/cash/ledger/page.tsx app/dashboard/expenses/expense-manager.tsx app/dashboard/page.tsx app/dashboard/users/users-manager.tsx components/sidebar-navigation.tsx components/context-navigation.tsx supabase/migrations/043_bank_management_and_statement.sql supabase/migrations/043_verify_bank_management.sql tests/cash-navigation-ui-041.cjs tests/bank-management-043.cjs deployment/043_BANK_MANAGEMENT_GUIDE.md
git commit -m "Add CenterPro 043 shared bank management and statement"
git push origin feature/centerpro-cash-039-040
```

Wait for the **Vercel Preview** deployment for this exact branch to become Ready. Ensure Preview variables point to **Testing Supabase**, not production. Do not merge `main` yet.

## Step C: Functional testing (Testing project)
1. Admin creates one company bank account → account appears once under Bank Accounts.
2. Admin records verified LKR 10,000 external funding → bank statement shows Debit 10,000 and balance +10,000.
3. Center A purchases LKR 2,000 using **bank transfer** and chooses the account → bank statement shows Center A, Purchase reference, Credit 2,000, balance 8,000.
4. Center B sells LKR 3,000 and receives **bank transfer** to same account → bank statement shows Center B, Sales reference, Debit 3,000, balance 11,000.
5. Filter Center A → only Center A entries show, but running balance still reflects all earlier Admin/Center transactions.
6. Repeat one identical source operation / reload → no duplicate book entries. Note normal POS idempotency still depends on POS RPC.
7. Login as Center User → no Bank Management navigation or statement permissions; POS still allows authorized bank account selection.
8. Test a **Purchase Card** payment → bank credit. Test Sale Card and Cheque → do not auto-post as cleared bank funds.
9. Test same account number for same bank twice → duplicate blocked by existing company/bank/account unique constraint.
10. Run verification SQL after test transactions and inspect any alert rows.

## Production release gate
Promote only after: Testing SQL verification PASS, Next build PASS, Preview role and balance tests PASS, historic payment/cancellation reviews complete, and real bank opening balances reconciled. Take separate **Production backup**; run migration before deploying matching UI; use approved Git merge with a rollback plan. This patch has not been executed on your live Supabase instance.
