# CenterPro 044c — Compact purchase draft bar and labor placement

This patch is based on the already applied 044 and 044b purchase updates.

## Changes
- Replaces the large `Purchase drafts` card with a slim bar directly below the dark purchase header.
- Shows a temporary **Draft Order** reference such as `D-0001` or `D-8AB123` on the bar. **These are not confirmed Purchase Order numbers**; the server assigns the official bill number when posting.
- The `Layers3` icon opens a floating list of unfinished local drafts. The `+` icon holds the current draft and opens a new draft. Drafts retain their existing IndexedDB storage, without changing payment or inventory logic.
- Retains a small POS/Detailed view selector from 044b.
- Removes Labor Session inputs from the product picker. They appear after weighing rows in Detailed Purchase view and remain editable on the Payment window.
- Mobile layouts use a 44px draft bar rather than a tall draft card.

## Apply and test (Testing feature branch only)
1. Confirm `git status --short` is clean and back up any important held browser drafts.
2. Extract this ZIP into the CenterPro-testing project folder (overwrite changed files).
3. `node tests/purchase-pos-044.cjs`
4. `node tests/purchase-detailed-view-044b.cjs`
5. `node tests/purchase-compact-bar-044c.cjs`
6. `npm run build`
7. Commit, push feature branch; test in Vercel Preview on desktop + narrow mobile.
8. On mobile, confirm no large draft card, number on header bar, icon popup, save/switch multiple unfinished drafts, and Labor Session only after product selection or in Payment.

No new Supabase SQL migration. Existing cash, purchase payment, invoice numbering and stock logic remain unchanged.

Note: Held drafts are browser/device-local. Do not clear site data or use incognito while relying on unsent drafts.
