# CenterPro navigation update

This patch reorganizes the sidebar and card launcher navigation to match `system_flow.pdf`.

- Purchases now offers New Purchase, Purchase Orders, Products, and Suppliers.
- Sales now offers New Sale, Sales Orders, Sales Summary, Products, and Customers.
- Inventory keeps its existing tools and adds Scrap as a submenu item.
- Finance exposes Customer Receivable, Supplier Payable, Cash & Payments, Expenses, Payments, and Cheque Management.
- Existing Configuration and Administration links remain available.
- The same menu structure is used by sidebar and card navigation.
- Removed the New Purchase button from the Purchase Orders list; New Purchase is accessed from navigation.
- Product and supplier shortcuts open the matching tab in Products & Suppliers.
- Sales Customers shortcut opens the customer tab.

No database migration is needed for this navigation update.

Copy these files over the matching paths in the CenterPro repository, then run `npm run build`.
