-- CenterPro 042 | Read-only center cash general ledger.
-- Prerequisite: 039_cash_accounts_double_entry.sql. Does not require 040.
-- No cash balances, journal entries, or historical transactions are modified.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.cash_account_entries') IS NULL OR
     to_regclass('public.cash_accounts') IS NULL OR
     to_regclass('public.user_center_access') IS NULL THEN
    RAISE EXCEPTION 'STOP: Migration 039 (cash accounts) must be applied first.';
  END IF;
END $$;

-- The cash account's debit increases its balance; its credit decreases it.
-- Running balance is calculated BEFORE filtering or paginating, so opening
-- and closing balances remain correct for any date range / page.
CREATE OR REPLACE FUNCTION public.center_cash_general_ledger(
  p_center uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 51,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  entry_id uuid,
  posted_at timestamptz,
  description text,
  source_type text,
  reference text,
  debit numeric,
  credit numeric,
  running_balance numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_role public.app_role;
  v_permissions text[];
  v_account uuid;
BEGIN
  SELECT organization_id, role, permissions
    INTO v_org, v_role, v_permissions
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true;

  IF v_org IS NULL OR (v_role <> 'super_admin' AND
    NOT ('cash' = ANY(coalesce(v_permissions, ARRAY[]::text[])))) THEN
    RAISE EXCEPTION 'Cash ledger access denied';
  END IF;

  -- Unlike the legacy is_admin()/can_access_center() helpers, regular Admin
  -- does NOT implicitly get access to other centers' financial ledgers.
  IF v_role <> 'super_admin' AND NOT EXISTS (
    SELECT 1 FROM public.user_center_access u
    JOIN public.centers c ON c.id = u.center_id
    WHERE u.user_id = auth.uid() AND u.center_id = p_center
      AND c.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Center ledger access denied: assign the center to this user';
  END IF;

  SELECT a.id INTO v_account
  FROM public.cash_accounts a
  JOIN public.centers c ON c.id = a.center_id
  WHERE a.organization_id = v_org AND c.organization_id = v_org
    AND a.kind = 'center' AND a.center_id = p_center;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Center cash account not found';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'From date must be before To date';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 OR
     p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 THEN
    RAISE EXCEPTION 'Invalid ledger page size or offset';
  END IF;

  RETURN QUERY
  WITH posted AS (
    SELECT e.id, e.created_at, e.source_table, e.source_id, e.posting_key, e.note,
      CASE WHEN e.debit_account_id = v_account THEN e.amount ELSE 0::numeric END AS dr,
      CASE WHEN e.credit_account_id = v_account THEN e.amount ELSE 0::numeric END AS cr,
      sum(CASE WHEN e.debit_account_id = v_account THEN e.amount ELSE -e.amount END)
        OVER (ORDER BY e.created_at, e.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS bal
    FROM public.cash_account_entries e
    WHERE e.organization_id = v_org AND
      (e.debit_account_id = v_account OR e.credit_account_id = v_account)
  ), page AS (
    SELECT p.* FROM posted p
    WHERE (p_from IS NULL OR (p.created_at AT TIME ZONE 'Asia/Colombo')::date >= p_from)
      AND (p_to IS NULL OR (p.created_at AT TIME ZONE 'Asia/Colombo')::date <= p_to)
    ORDER BY p.created_at, p.id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    p.id, p.created_at,
    concat_ws(' — ',
      CASE
        WHEN p.source_table = 'cash_ledger' THEN CASE
          WHEN cl.movement_type = 'sale_receipt' THEN 'Cash sales / customer receipt'
          WHEN cl.movement_type = 'purchase' THEN 'Cash purchase / payment'
          WHEN cl.movement_type = 'allocation' THEN 'Cash received at center'
          WHEN cl.movement_type = 'refund' THEN 'Cash refund received'
          ELSE 'Center cash adjustment' END
        WHEN p.source_table = 'expense_cash_ledger' THEN CASE
          WHEN xl.movement_type = 'expense' THEN 'Center cash expense'
          WHEN xl.movement_type = 'allocation' THEN 'Cash received at center'
          ELSE 'Center expense cash adjustment' END
        WHEN p.source_table = 'center_cash_remittances' THEN 'Center cash remitted to Admin'
        WHEN p.source_table = 'center_cash_issues' THEN 'Cash transfer / receipt'
        WHEN p.source_table = 'admin_cash_in' THEN 'Admin cash funding'
        ELSE replace(p.source_table, '_', ' ')
      END,
      nullif(trim(p.note), '')
    )::text,
    replace(p.source_table, '_', ' ')::text,
    coalesce(
      po.po_number,
      so.sale_number,
      si.invoice_number,
      cc.reference,
      nullif(cl.reference_type, ''),
      nullif(xl.reference_type, ''),
      substring(p.source_id::text, 1, 8)
    )::text,
    p.dr, p.cr, p.bal
  FROM page p
  LEFT JOIN public.cash_ledger cl
    ON p.source_table = 'cash_ledger' AND cl.id = p.source_id
  LEFT JOIN public.expense_cash_ledger xl
    ON p.source_table = 'expense_cash_ledger' AND xl.id = p.source_id
  LEFT JOIN public.purchase_orders po
    ON cl.reference_type = 'purchase_order' AND po.id = cl.reference_id
  LEFT JOIN public.sales_orders so
    ON cl.reference_type = 'sales_order' AND so.id = cl.reference_id
  LEFT JOIN public.sales_invoices si
    ON cl.reference_type = 'sales_invoice' AND si.id = cl.reference_id
  LEFT JOIN public.center_cash_issues cc
    ON cl.reference_type = 'combined_cash_issue' AND cc.id = cl.reference_id
  ORDER BY p.created_at, p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.center_cash_general_ledger(uuid,date,date,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.center_cash_general_ledger(uuid,date,date,integer,integer)
  TO authenticated;
COMMIT;
