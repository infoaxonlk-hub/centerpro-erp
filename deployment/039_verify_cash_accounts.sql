-- CenterPro 039 | READ-ONLY verification. Run in the SAME Supabase project.
-- 1. One Admin Main + one per center (+ control accounts) for each organization.
SELECT o.name AS organization,
       a.kind, coalesce(c.code,'—') AS center_code,a.name AS account_name,
       coalesce(sum(CASE WHEN e.debit_account_id=a.id THEN e.amount WHEN e.credit_account_id=a.id THEN -e.amount END),0)::numeric(18,2) AS balance
FROM public.cash_accounts a JOIN public.organizations o ON o.id=a.organization_id
LEFT JOIN public.centers c ON c.id=a.center_id
LEFT JOIN public.cash_account_entries e ON e.debit_account_id=a.id OR e.credit_account_id=a.id
GROUP BY o.name,a.id,a.kind,c.code,a.name
ORDER BY organization,a.kind,center_code;

-- 2. NO rows means all CENTER cash accounts reconcile with the legacy physical cash ledgers.
WITH expected AS (
 SELECT c.id AS center_id,c.organization_id,
        (SELECT coalesce(sum(CASE WHEN l.movement_type IN ('allocation','refund','sale_receipt') THEN l.amount ELSE -l.amount END),0)
           FROM public.cash_ledger l WHERE l.center_id=c.id)
        +
        (SELECT coalesce(sum(CASE WHEN l.movement_type IN ('allocation','adjustment') THEN l.amount ELSE -l.amount END),0)
           FROM public.expense_cash_ledger l WHERE l.center_id=c.id) AS balance
 FROM public.centers c
), actual AS (
 SELECT a.center_id,coalesce(sum(CASE WHEN e.debit_account_id=a.id THEN e.amount ELSE -e.amount END),0) AS balance
 FROM public.cash_accounts a LEFT JOIN public.cash_account_entries e
 ON e.debit_account_id=a.id OR e.credit_account_id=a.id WHERE a.kind='center'
 GROUP BY a.center_id
)
SELECT c.code,c.name,expected.balance AS original_ledgers,actual.balance AS new_cash_account
FROM expected JOIN actual USING(center_id)
JOIN public.centers c ON c.id=expected.center_id
WHERE expected.balance<>actual.balance;

-- 3. NO rows means journal mirrors every cash ledger row exactly once.
SELECT 'cash_ledger' AS source, count(*) AS missing_postings FROM public.cash_ledger l
WHERE NOT EXISTS(SELECT 1 FROM public.cash_account_entries e WHERE e.source_table='cash_ledger' AND e.source_id=l.id AND e.posting_key='posted')
HAVING count(*)>0
UNION ALL
SELECT 'expense_cash_ledger',count(*) FROM public.expense_cash_ledger l
WHERE NOT EXISTS(SELECT 1 FROM public.cash_account_entries e WHERE e.source_table='expense_cash_ledger' AND e.source_id=l.id AND e.posting_key='posted')
HAVING count(*)>0
UNION ALL
SELECT 'admin_cash_in',count(*) FROM public.admin_cash_in l
WHERE NOT EXISTS(SELECT 1 FROM public.cash_account_entries e WHERE e.source_table='admin_cash_in' AND e.source_id=l.id AND e.posting_key='posted')
HAVING count(*)>0;

-- 4. NO rows means every center has exactly one account.
SELECT c.id,c.code,c.name FROM public.centers c
LEFT JOIN public.cash_accounts a ON a.center_id=c.id AND a.kind='center'
GROUP BY c.id,c.code,c.name HAVING count(a.id)<>1;

-- 5. Inspect old handovers still awaiting receipt (these are intentionally not deleted).
SELECT 'purchase_legacy' AS source, count(*) AS pending FROM public.cash_handovers WHERE status='pending'
UNION ALL SELECT 'expense_legacy', count(*) FROM public.expense_cash_handovers WHERE status='pending'
UNION ALL SELECT 'combined', count(*) FROM public.center_cash_issues WHERE status='pending';
