# Offline capable mobile POS update

This update adds installable, mobile-first browser support for the existing Sales POS and Purchase POS.

## Important behavior

- Open both **New sale · POS** and **New Purchase** once while online on every device that needs offline access. This lets the browser cache each POS screen and its code.
- Product/cart edits are saved locally in that browser. Existing sales stock is also cached as a snapshot.
- If the network drops, confirming a sale or purchase saves it in that device's browser-local IndexedDB queue and shows **waiting to sync**. It is not treated as a posted bill: stock, cash, receivables/payables, and audit records update only after the server accepts it.
- When the connection returns, the screen retries the queued transaction. The server rechecks live stock, cash, products, and payment details. If something changed, the order stays pending and offers **Review and edit**.
- Keep the same browser profile and user account until pending transactions finish syncing. Offline mode cannot create a new customer or guarantee stock/cash that another user has changed.

## Main branch setup

This release targets `main`. Pushing it can update the production Vercel site.

1. Apply `supabase/migrations/027_offline_pos_purchase_idempotency.sql` in the Supabase project connected to the **main production deployment**.
2. Download and extract this update zip to `Downloads\CenterPro-Offline-POS-Update`.
3. In PowerShell, copy only the update files onto the clean `main` checkout. Keep unrelated work intact:

```powershell
$repo = "$HOME\Downloads\CenterPro-testing"
$update = "$HOME\Downloads\CenterPro-Offline-POS-Update"
Set-Location $repo
git status --short
git switch main
git pull --ff-only origin main

$files = @(
  "OFFLINE-POS-UPDATE.md",
  "app\dashboard\purchases\new\purchase-form.tsx",
  "app\dashboard\purchases\new\page.tsx",
  "app\dashboard\purchases\page.tsx",
  "app\dashboard\sales\sales-pos.tsx",
  "app\dashboard\sales\screen.tsx",
  "app\dashboard\sales\sales-manager.tsx",
  "app\layout.tsx",
  "app\purchase-pos.css",
  "app\offline-pos.css",
  "components\offline-pos-link.tsx",
  "components\offline-pos-status.tsx",
  "components\sidebar-navigation.tsx",
  "lib\offline-pos.ts",
  "public\manifest.webmanifest",
  "public\service-worker.js",
  "supabase\migrations\027_offline_pos_purchase_idempotency.sql"
)
foreach ($file in $files) {
  $source = Join-Path $update $file
  $destination = Join-Path $repo $file
  New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

npm run build
git status --short
git add $files
git commit -m "Add offline mobile POS for sales and purchases"
git push origin main
```

If `git status --short` shows existing edits before copying, stop and save those edits first. After Vercel deploys `main`, on a phone open the production site while connected, sign in, and open both POS pages once. Test a draft, turn off Wi-Fi/mobile data, confirm a sale/purchase, restore connectivity, then verify exactly one bill appears and the pending count clears.

## Database safety

Sales already use a request UUID for safe retries. Migration 027 adds the corresponding idempotency wrapper for purchases, so a dropped network response does not create a duplicate purchase when retried.
