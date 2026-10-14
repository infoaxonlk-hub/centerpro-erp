# CenterPro 042 — Center Cash General Ledger

## Scope
- Adds **Cash/Bank Manage → Cash Ledger**, alongside the existing **Cash Management** submenu.
- Shows only the selected **Center Cash Account**, with date/time, transaction description, document/reference, Debit, Credit and absolute Running Balance.
- Uses the **existing append-only 039 `cash_account_entries`** (does not create financial entries or change their values).
- Center cash is a **debit-balance account**: Debit increases cash; Credit decreases cash.
- Date range and pagination are based on Asia/Colombo dates. Running balances are computed before applying filters and pagination; each page shows the correct opening balance.
- Normal Admin and Center User can only open center ledgers **explicitly assigned in Users & Access**. If none assigned, the page shows an instruction and no financial data. Super Admin can select any center in their organization. Bank Account ledgers are deliberately excluded.

## Testing deployment (apply in the same feature/centerpro-cash-039-040 branch)
1. Verify Migration 039 has been applied to your **testing Supabase**, and back up testing DB before new SQL.
2. Run `supabase/migrations/042_center_cash_ledger_readonly.sql` in the **testing Supabase SQL Editor**. It is an additive read-only RPC, and does not depend on Migration 040.
3. Extract the ZIP into the **CenterPro-testing project root** (not the original/production repo):
   ```powershell
   Expand-Archive -LiteralPath "$HOME\Downloads\CenterPro_042_Cash_Ledger_Patch.zip" -DestinationPath (Get-Location).Path -Force
   ```
4. Run:
   ```powershell
   node tests/cash-ledger-042.cjs
   node tests/cash-navigation-ui-041.cjs
   npm run build
   git status --short
   ```
5. **Only if all checks pass**, commit these files and push the existing feature branch:
   ```powershell
   git add components/sidebar-navigation.tsx components/context-navigation.tsx app/dashboard/cash/ledger tests/cash-ledger-042.cjs tests/cash-navigation-ui-041.cjs supabase/migrations/042_center_cash_ledger_readonly.sql deployment/042_CASH_LEDGER_GUIDE.md
   git commit -m "Add center-scoped double-entry cash general ledger"
   git push origin feature/centerpro-cash-039-040
   ```
6. In Vercel, verify the **Preview** deployment for the feature branch points to the **testing Supabase**. Open **Cash/Bank Manage → Cash Ledger**.
7. Test with three users:
   - Admin assigned only Center A: Center A is visible, Center B is not in the list; trying URL `?center=<Center-B-ID>` reveals no ledger.
   - Center User assigned only Center B: only Center B visible.
   - Super Admin: choose A or B, and balances remain distinct.
8. Test a Center Cash In receipt, a Cash Sale, Cash Purchase and Cash Expense; verify descriptions, debit/credit direction, and running balance. For date range, also check opening balance with earlier transactions. The last running balance without date filtering should equal current center cash balance.
9. Do not run 039 again; no banking screens/entries are changed. 040 may be deployed separately after its own verification.

## Production release
After testing, back up Production, apply SQL 042 to Production Supabase (already on 039), deploy the approved tested feature commit, run the access and balance smoke checks, and retain the rollback plan for code. Do not run the migration on the `collectpro_original` project by mistake.

## Notes
- This patch has no CSV export or editing actions: ledger is **read-only**.
- Ordinary admins without an explicit center assignment must be assigned the desired center by Super Admin through Users & Access. This intentionally tightens ledger viewing compared to the older admin-all-centers cash management view.
- SQL errors mean stop and investigate; do not manually alter RLS or grant service-role access in the browser.
