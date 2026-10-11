# Center available cash update

## Changes
- Purchase POS shows the selected center's live available cash in both the product and payment steps.
- While offline, POS labels the displayed amount as the last online balance; the server still validates the cash when syncing.
- Cash & Payments shows an explicit “Available cash by center” section with the current balance for each visible center.
- Cash balances are read from the existing `center_cash_balance` database function. No SQL migration is needed.

## Apply on Windows
Extract the ZIP into the root of `C:\Users\banda_8k3w5n5\Downloads\CenterPro-testing` and allow the files to overwrite. Then run `npm run build` from that repository folder.
