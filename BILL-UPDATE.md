# Bill printing update

Sales receipt now has an explicit New sale · POS action. Sales and Purchase checkout both offer Print bill · Before payment, opening a draft preview without posting stock, cash, or payments. Return to payment preserves entered values. Drafts are explicitly labelled unconfirmed and do not claim payment was received.

Sales and Purchase final receipts share the same compact 80mm thermal layout with organization, center, document number, date, party, item quantity/rate, total, paid amount, credit and status. Select 80mm paper and disable browser headers/footers in the print dialog.

No migration required. Targeted ESLint, production build and isolated mocked Sales component checks passed, including draft preview/back and prevention of F10 confirmation inside preview. Physical printer and live browser visual validation remain to be checked after deployment.
