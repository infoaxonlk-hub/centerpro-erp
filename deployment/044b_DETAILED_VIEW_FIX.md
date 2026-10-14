# CenterPro 044b — Detailed Purchase Order view selector fix

## Reason
Update 044 retains DetailedPurchaseEntry, but a new Vercel Preview domain has independent browser localStorage (default POS), and older draft metadata could override the user's saved Purchase View preference.

## Fix
- Add a visible **Purchase view** selector to the Purchase drafts toolbar: Purchase POS / Detailed purchase order.
- Save the choice in the same localStorage key used by Appearance Settings.
- Prefer the explicit browser choice when loading an older draft instead of reverting to its stored mode.
- No DB, payment, inventory, or cash logic changes.

## Apply (in CenterPro-testing feature branch)
1. Ensure `git status` is clean.
2. Extract ZIP into project root with Force.
3. Run `node tests/purchase-detailed-view-044b.cjs`, `node tests/purchase-pos-044.cjs`, `npm run build`.
4. Verify on Vercel Preview that Purchase view = Detailed purchase order opens its detailed entry form and labor selector, and stays selected after reload and draft switching.
5. Commit and push only after passing all checks.

## Manual fallback
Appearance Settings -> Purchase view -> Detailed purchase order. Because Preview URLs are distinct domains, saved settings do not automatically carry over.

## Limitations
Current draft stores locally in the browser (IndexedDB). Never clear browser site data while important drafts are held.
