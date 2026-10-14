# CenterPro 041 - Cash/Bank Manage UI Simplification

Target: **feature/centerpro-cash-039-040** branch, **after Migration 039 is already applied**.

## Changes

- All Apps / Dashboard tile and sidebar: `Cash & Payments` -> `Cash/Bank Manage`.
- That workspace now has **one** submenu: `Cash Management` (`/dashboard/cash/available`).
- Cash Management displays Admin Main and permitted center cash balances, Issue to Center, Add Cash In, and actionable pending receipts.
- Historical transaction lists and debit/credit table are not displayed on this screen.
- Existing 039 database schema, RPCs, transaction records, and historical routes are **not** deleted or altered.
- No SQL migration is necessary for UI update 041.

## PowerShell - apply in your CenterPro-testing folder

1. Confirm `git branch --show-current` is `feature/centerpro-cash-039-040` and `git status --short` is clean before applying.
2. Download `CenterPro_041_Cash_Bank_UI_Patch.zip` to your Windows Downloads folder.
3. Extract with:

```powershell
Expand-Archive -LiteralPath "$HOME\Downloads\CenterPro_041_Cash_Bank_UI_Patch.zip" -DestinationPath (Get-Location).Path -Force
```

4. Run:

```powershell
node tests/cash-navigation-ui-041.cjs
npm run build
```

5. If both pass, review `git diff --stat`, then:

```powershell
git add components/sidebar-navigation.tsx components/context-navigation.tsx app/dashboard/page.tsx app/dashboard/users/users-manager.tsx app/dashboard/expenses/expense-manager.tsx app/dashboard/cash/screen.tsx app/dashboard/cash/unified-cash.tsx app/dashboard/cash/unified-cash.css tests/cash-navigation-ui-041.cjs deployment/041_CASH_UI_GUIDE.md
git commit -m "Simplify Cash/Bank Manage navigation and Cash Management"
git push origin feature/centerpro-cash-039-040
```

6. Open the Vercel Preview deployment for this branch (not production). Verify it connects to the intended testing Supabase database.
7. Test: All Apps -> Cash/Bank Manage -> Cash Management (one tile only); admin balances, Issue to Center, Add Cash In; center-user permitted center balances and receipt confirmation. Verify Cash In and issue update the balances correctly **once**.

## Important

This patch assumes the currently deployed **039** source. The previously generated **040** patch also replaces `app/dashboard/cash/screen.tsx` and `app/dashboard/cash/unified-cash.tsx`. Do not blindly overlay the old 040 patch on top of this UI; merge those screens before implementing 040, or the new UI may be reverted or 040 remittance functionality lost. Database Migration 040 is **not** part of this UI update.

Build and live Supabase tests must be performed in your own testing environment before production rollout.
