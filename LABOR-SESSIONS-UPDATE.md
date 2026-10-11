# Labor and session update

## Included

- Admins can add and edit laborers, contact details, rate basis, and rate.
- Rates are **per laborer**, and the rate is copied onto the session when assigned. Later rate edits do not change an existing session.
- Admins can open a center session for purchasing, sales, or both, assign laborers, and close the session.
- Purchase and sales payment screens can attach an open session and enter the order's load count. The POS carries those details through offline sync too.
- The session page totals linked kilograms, sacks, and loads, calculates each worker's expected wage separately, and shows paid and due amounts.
- After a session is closed, users with Labor access can record a cash payout. It is posted through the existing **Labor wages** expense category and expense cash balance checks.

Pay calculation:

- Per kilogram: linked order quantity × worker rate.
- Per sack: purchase sack counts plus sales quantities whose unit is sack, bag, or goni.
- Per load: manually entered load counts × worker rate.
- Fixed per order: worker rate × number of linked bills.

## Apply

1. Extract the ZIP into the existing `CenterPro-testing` repository and replace files when prompted.
2. Run `npm run build` in PowerShell.
3. In Supabase SQL Editor, run `supabase/migrations/036_labor_sessions.sql` once. It adds tables and functions; it does not clear existing business data.
4. Grant the **Labor & Sessions** permission to the admin and center users who need it in Users → Edit access. Purchase/sales users need their existing module access too.
5. Redeploy from the branch connected to the pilot Vercel project.

Start in **Labor & Sessions**: add workers and rates, open a session for the center and operation, and assign its workers. On each purchase/sale, select the session and enter load count when that rate basis applies. Close the session when the run is complete; the page then shows each worker's expected and outstanding amount. Cash payout uses expense cash, so issue sufficient expense cash to the center first if needed.
