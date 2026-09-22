# Standalone Sales POS update

Open Sales > New sale · POS. Sales entry now uses a dedicated full-screen product/cart view, followed by a separate customer and split-payment checkout. Sales history, customers and selling prices remain in the management view.

Supports product/category search, center stock locations, stock quantity checks, quick customer creation, initial total Cash allocation and remaining-amount allocation for added payment lines. Existing sale confirmation and receipt routes are retained.

Keyboard: F2 search, F4 center, F9 payment, F10 confirm, Escape back from checkout.

No new database migration is required for this UI update. Existing Sales migrations 017 and 018 must already be applied as described in SALES-DEPLOYMENT.md.

Validation: targeted ESLint and production Next.js build passed. Isolated DOM component checks with mocked RPCs passed for product merging, stock limits, F9 checkout, cash defaults, remaining allocations, credit customer requirement, checkout/back persistence, split-payment payload and required cheque fields. A live browser visual check was unavailable due browser policy; verify desktop/mobile layout and a real sale in your deployed environment.
