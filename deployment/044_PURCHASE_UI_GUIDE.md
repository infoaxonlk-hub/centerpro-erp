# CenterPro 044 — Purchase UI Improvements (Testing First)

## Scope

1. The **Detailed Purchase Order** entry screen offers an optional **Labor Session** selector and **Loads** input *before* checkout. Sessions are filtered to open purchase/both sessions of the selected center; existing backend RPC continues attaching the selected session when confirming a purchase. Eligible sessions are fetched under Supabase RLS. Admins can open/manage sessions in the Labor module in another browser tab.
2. **Hold & new purchase** preserves the current incomplete purchase (items, supplier, center, payments, notes, selected labor session, loads, entry mode, checkout state and request ID) in a per-user, per-draft IndexedDB record. The operator can resume another saved draft from the selector. An unfinished draft is **not** a confirmed purchase and does not change inventory, cash or payables.
3. The Purchase Payment **Summary** no longer includes the orange/green allocation breakdown; it retains Total Quantity (with UOM, separated for mixed units) and Total Amount. Actual payment allocations and validation remain in the payment form.
4. New-purchase-after-confirmation resets the labor selections, notes and idempotency request ID.

This update does **not** include SQL migrations. It does not change purchase posting, cash/bank accounting, or the pending 040 flow.

## Apply to your existing Testing branch

Only apply to a clean `feature/centerpro-cash-039-040` testing branch. Never overwrite `main` or `centerpro_original` directly.

```powershell
cd "$HOME\Downloads\CenterPro-testing"
git branch --show-current
git status --short
Expand-Archive -LiteralPath "$HOME\Downloads\CenterPro_044_Purchase_UI_Patch.zip" -DestinationPath (Get-Location).Path -Force
node tests/purchase-pos-044.cjs
npm run build
```

If tests or build fail, stop and share the *full first error* before committing.

If both pass:

```powershell
git add app/dashboard/purchases/new/purchase-form.tsx app/dashboard/purchases/new/detailed-purchase-entry.tsx app/dashboard/purchases/new/page.tsx app/purchase-pos.css lib/offline-pos.ts lib/purchase-quantity-summary.ts tests/purchase-pos-044.cjs deployment/044_PURCHASE_UI_GUIDE.md
git commit -m "Improve CenterPro purchase entry labor drafts and summary UI"
git push origin feature/centerpro-cash-039-040
```

Wait for Vercel Preview Deployment **Ready**, and verify the Preview environment uses the *Testing Supabase project* before posting test bills.

## Functional UAT

1. In **Detailed Purchase Order** choose an open labor session for your center, set Loads (e.g. 2), add weighed items, and confirm the bill. Check the bill is associated with that labor session. With no open session, the selector says No labor session; an authorized manager can create one in Labor Sessions.
2. Start Purchase A (supplier, two products, different weights/prices, loads); click **Hold & new purchase**. Start Purchase B. Use **Open draft** to resume A and confirm its details survived (including checkout/payment state); return to B. Confirm both separately and verify distinct bill numbers and accurate inventory/cash movements.
3. In the Payment screen verify the Purchase Summary does not show **Purchase total / Allocated / Paid excl credit / Credit balance / Over allocated** block. It shows **Total Quantity** with units and **Total Amount**. Sample UOM: `13.5 KG · 2 PCS`; do not sum incompatible units.
4. Enter an incorrect payment allocation; the form should show its warning and **Confirm purchase** must remain disabled until amounts match the purchase total.
5. Test Desktop and Mobile view, and choose a different center: only eligible labor sessions should appear.
6. Test after successful purchase: click **New purchase**, then confirm another purchase. Both should have distinct request IDs/bills.
7. Drafts are **local to the same browser and device**, and scoped to the signed-in user's ID. They do not sync between devices; clearing website storage deletes unfinished drafts. Confirmed purchases always live in Supabase. Pending offline queued purchases are managed by the existing offline sync mechanism.

## Rollback

If needed, revert the 044 Git commit and redeploy its parent Vercel preview. No database rollback is required.
