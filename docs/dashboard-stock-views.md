Stock explorer opens with Product cards. The View selector and Appearance → Stock view share a preference saved in the current browser. Detailed table, Stock graph and Movement (FSN) remain available. Filters apply to every view; cards sum each product across matching qualities and locations, with a location breakdown. Different units remain separate.

The dashboard summary appears in grouped cards, app and list navigation:

- Today's purchases and sales: confirmed order totals, including credit, using confirmation time and the Sri Lanka calendar day. Draft and cancelled orders are excluded. Separate returns are not deducted from these gross totals.
- Purchase order count: all confirmed purchase orders, across all dates.
- Center available cash: current center account balances, including cash expenses and other posted entries, with a breakdown by center.
- Total stock: movement balance, grouped by unit.
- Highest stock: product name and positive quantity, separately for each unit. Its link opens the stock explorer filtered to that product.

Summaries use the signed-in user's business, enabled modules, permissions and database row policies. They include only permitted centers. Summary reads paginate beyond the API row limit. No SQL migration is needed for this change; existing migrations through 048 are assumed.
