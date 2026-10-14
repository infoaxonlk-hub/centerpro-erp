-- CenterPro 043 | READ-ONLY VERIFICATION. Run after migration 043.
-- 1. Company bank account balances and posting counts.
SELECT b.id, pb.name AS bank_name,b.account_number,b.account_name,
 COUNT(e.id) AS bank_book_entries,
 coalesce(sum(CASE WHEN e.direction='debit' THEN e.amount ELSE -e.amount END),0) AS book_balance
FROM public.bank_accounts b JOIN public.payment_banks pb ON pb.id=b.bank_id
LEFT JOIN public.bank_book_entries e ON e.bank_account_id=b.id
GROUP BY b.id,pb.name,b.account_number,b.account_name ORDER BY pb.name,b.account_number;

-- 2. UNBALANCED/MISSING contra entries: EXPECT NO ROWS.
SELECT e.id,e.source_table,e.source_id,e.amount AS bank_amount,c.amount AS contra_amount
FROM public.bank_book_entries e LEFT JOIN public.bank_book_contra_entries c ON c.bank_entry_id=e.id
WHERE c.bank_entry_id IS NULL OR c.organization_id<>e.organization_id
 OR c.amount<>e.amount OR c.direction=e.direction;

-- 3. Missing posted bank transfer/card payments: EXPECT NO ROWS.
SELECT 'purchase' AS source,p.id,p.method::text,p.amount
FROM public.payments p WHERE p.method::text IN ('bank_transfer','card') AND p.bank_account_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.bank_book_entries b WHERE b.source_table='payments' AND b.source_id=p.id)
UNION ALL
SELECT 'sale',p.id,p.method::text,p.amount
FROM public.sales_payments p WHERE p.method::text='bank_transfer' AND p.bank_account_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.bank_book_entries b WHERE b.source_table='sales_payments' AND b.source_id=p.id);

-- 4. Suspicious/missing account link (manual review, may show legacy rows).
SELECT 'purchase' AS source,p.id,p.method::text AS method,p.amount
FROM public.payments p WHERE p.method::text IN ('bank_transfer','card') AND p.bank_account_id IS NULL
UNION ALL
SELECT 'sale',p.id,p.method::text,p.amount
FROM public.sales_payments p WHERE p.method::text='bank_transfer' AND p.bank_account_id IS NULL;

-- 5. Historical cancelled bills with bank payments (must manually reconcile real refunds).
SELECT 'purchase' AS source,p.id,p.amount,po.po_number AS bill
FROM public.payments p JOIN public.purchase_orders po ON po.id=p.purchase_order_id
WHERE p.bank_account_id IS NOT NULL AND p.method::text IN ('bank_transfer','card') AND po.status='cancelled'
UNION ALL
SELECT 'sale',p.id,p.amount,so.sale_number
FROM public.sales_payments p JOIN public.sales_orders so ON so.id=p.sales_order_id
WHERE p.bank_account_id IS NOT NULL AND p.method::text='bank_transfer' AND so.status='cancelled';
