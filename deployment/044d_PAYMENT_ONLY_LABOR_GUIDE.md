# CenterPro Update 044d — Labor Session in Payment Window Only

## Scope
- Remove the Labor Session and Loads panel from **Detailed Purchase → Enter Weights**.
- Keep **Labor Session + Loads** inside **Payment Window** (visible when eligible open labor sessions exist for the selected center).
- Preserve draft state, labor session validation, purchase confirmation RPC payload, and all other Purchase POS features.
- No Supabase migration required. No database data is changed by this patch.

## Source baseline
Apply this patch **after 044c Compact Order Bar** to the same testing feature branch. Do not apply over unrelated uncommitted changes without reviewing the diff.

## Steps (PowerShell from CenterPro-testing folder)
1. `git status --short` (ensure clean)
2. `Expand-Archive -LiteralPath "$HOME\Downloads\CenterPro_044d_Payment_Only_Labor_Patch.zip" -DestinationPath (Get-Location).Path -Force`
3. `node tests/purchase-labor-payment-only-044d.cjs`
4. `node tests/purchase-pos-044.cjs`
5. `node tests/purchase-compact-bar-044c.cjs`
6. `node tests/purchase-detailed-view-044b.cjs`
7. `npm run build`
8. Review `git diff --check` and `git status --short`, then commit and push feature branch.

## Browser smoke test — Desktop and Mobile
- New Purchase → Detailed → Add Product → Enter Weights: no Labor Session/Loads fields.
- Continue to Payment Window: Labor Session + Loads appear when an eligible open session exists.
- Select a session and enter loads, navigate Back and forward: values remain.
- Confirm purchase using a test transaction: labor association and loads appear in relevant labor session reports.
- POS purchase mode, draft hold/resume, and cash/payment allocations still work.

## Notes
Automated tests are structural checks; they do not replace a full TypeScript production build or real browser transaction test.
