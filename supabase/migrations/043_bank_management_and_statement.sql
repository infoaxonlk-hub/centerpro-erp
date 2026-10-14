-- CenterPro 043 | Shared company bank accounts, bank funding and bank book.
-- Requires 009_bank_accounts.sql, 018_sales_workflow.sql, 039_cash_accounts_double_entry.sql.
-- Safe to apply after 042; does NOT require 040.
-- No existing payments are deleted. Historical direct bank-transfer / purchase-card entries
-- are journaled once. Cheques and incoming card sales are NOT treated as cleared bank funds.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.bank_accounts') IS NULL OR
    to_regclass('public.payments') IS NULL OR to_regclass('public.sales_payments') IS NULL OR
    to_regclass('public.profiles') IS NULL OR
    to_regclass('public.cash_accounts') IS NULL THEN
   RAISE EXCEPTION 'Missing prerequisite CenterPro payment/bank tables';
 END IF;
END $$;

-- Master is already shared by organization, not center. Enforce valid bank ownership
-- and normalized account numbers on NEW/UPDATED records (old rows untouched).
CREATE OR REPLACE FUNCTION public.bank_accounts_validate_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 NEW.account_number:=trim(NEW.account_number);
 IF NEW.account_number IS NULL OR NEW.account_number='' THEN RAISE EXCEPTION 'Bank account number required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_banks b WHERE b.id=NEW.bank_id
   AND b.organization_id=NEW.organization_id) THEN
   RAISE EXCEPTION 'Bank must belong to the same company'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bank_accounts_company_validate ON public.bank_accounts;
CREATE TRIGGER bank_accounts_company_validate BEFORE INSERT OR UPDATE ON public.bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.bank_accounts_validate_company();
-- Existing admin-only RLS policy still governs inserts.
GRANT INSERT ON public.bank_accounts TO authenticated;

CREATE TABLE IF NOT EXISTS public.bank_book_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id),
 center_id uuid REFERENCES public.centers(id),
 direction text NOT NULL CHECK(direction IN ('debit','credit')),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 source_table text NOT NULL,
 source_id uuid NOT NULL,
 description text NOT NULL CHECK(length(trim(description))>0),
 reference text,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES public.profiles(id),
 UNIQUE(source_table,source_id)
);
CREATE INDEX IF NOT EXISTS bank_book_order_idx ON public.bank_book_entries(bank_account_id,created_at,id);
CREATE INDEX IF NOT EXISTS bank_book_center_idx ON public.bank_book_entries(center_id,created_at);

CREATE TABLE IF NOT EXISTS public.bank_fundings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 source text NOT NULL,
 details text NOT NULL,
 reference text,
 posting_date timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

-- No browser-side modification of the book or funding rows.
ALTER TABLE public.bank_book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_fundings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_book_admin_read ON public.bank_book_entries;
CREATE POLICY bank_book_admin_read ON public.bank_book_entries FOR SELECT TO authenticated
 USING(organization_id=(public.current_profile()).organization_id AND public.is_admin());
DROP POLICY IF EXISTS bank_fundings_admin_read ON public.bank_fundings;
CREATE POLICY bank_fundings_admin_read ON public.bank_fundings FOR SELECT TO authenticated
 USING(organization_id=(public.current_profile()).organization_id AND public.is_admin());
REVOKE ALL ON public.bank_book_entries,public.bank_fundings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bank_book_entries,public.bank_fundings TO authenticated;

-- Immutable accounting evidence: privileged backend function/SQL maintenance only.
CREATE OR REPLACE FUNCTION public.bank_book_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Bank book is append-only: use a new corrective transaction'; END $$;
DROP TRIGGER IF EXISTS bank_book_immutable ON public.bank_book_entries;
CREATE TRIGGER bank_book_immutable BEFORE UPDATE OR DELETE ON public.bank_book_entries
FOR EACH ROW EXECUTE FUNCTION public.bank_book_reject_mutation();

-- Every bank-side debit/credit has an equal, opposite control posting.
-- This is a balanced bank SUBLEDGER; it is not the full statutory general ledger.
CREATE TABLE IF NOT EXISTS public.bank_book_contra_entries (
 bank_entry_id uuid PRIMARY KEY REFERENCES public.bank_book_entries(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 control_account text NOT NULL CHECK(control_account IN ('funding_control','purchase_payment_control','sales_receipt_control')),
 direction text NOT NULL CHECK(direction IN ('debit','credit')),
 amount numeric(18,2) NOT NULL CHECK(amount>0)
);
ALTER TABLE public.bank_book_contra_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_contra_admin_read ON public.bank_book_contra_entries;
CREATE POLICY bank_contra_admin_read ON public.bank_book_contra_entries FOR SELECT TO authenticated
 USING(organization_id=(public.current_profile()).organization_id AND public.is_admin());
REVOKE ALL ON public.bank_book_contra_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bank_book_contra_entries TO authenticated;
CREATE OR REPLACE FUNCTION public.bank_book_post_contra()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.bank_book_contra_entries(bank_entry_id,organization_id,control_account,direction,amount)
 VALUES(NEW.id,NEW.organization_id,
   CASE WHEN NEW.source_table='bank_fundings' THEN 'funding_control'
        WHEN NEW.source_table='payments' THEN 'purchase_payment_control'
        ELSE 'sales_receipt_control' END,
   CASE WHEN NEW.direction='debit' THEN 'credit' ELSE 'debit' END,NEW.amount);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bank_book_auto_contra ON public.bank_book_entries;
CREATE TRIGGER bank_book_auto_contra AFTER INSERT ON public.bank_book_entries
FOR EACH ROW EXECUTE FUNCTION public.bank_book_post_contra();
CREATE OR REPLACE FUNCTION public.bank_contra_reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Bank control entries are append-only'; END $$;
DROP TRIGGER IF EXISTS bank_contra_immutable ON public.bank_book_contra_entries;
CREATE TRIGGER bank_contra_immutable BEFORE UPDATE OR DELETE ON public.bank_book_contra_entries
FOR EACH ROW EXECUTE FUNCTION public.bank_contra_reject_mutation();

-- Payment source to shared Admin bank account. One row per payment, regardless of center.
CREATE OR REPLACE FUNCTION public.bank_book_post_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;v_center uuid;v_number text;v_account_org uuid;v_direction text;v_description text;v_created_by uuid;
BEGIN
 IF NEW.bank_account_id IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='payments' THEN
   -- Transfers and outbound card charges debit the shared bank balance (credit entry).
   IF NEW.method::text NOT IN ('bank_transfer','card') THEN RETURN NEW; END IF;
   SELECT p.organization_id,p.center_id,p.po_number INTO v_org,v_center,v_number
     FROM public.purchase_orders p WHERE p.id=NEW.purchase_order_id;
   IF v_org IS NULL OR v_org<>NEW.organization_id OR v_center<>NEW.center_id THEN
     RAISE EXCEPTION 'Purchase bank payment organization/center mismatch'; END IF;
   v_created_by:=NEW.created_by;
   v_direction:='credit';
   v_description:=CASE WHEN NEW.method::text='card' THEN 'Purchase card payment' ELSE 'Purchase bank transfer' END;
 ELSIF TG_TABLE_NAME='sales_payments' THEN
   -- Incoming card settlements/cheques must NOT inflate bank until cleared.
   IF NEW.method::text<>'bank_transfer' THEN RETURN NEW; END IF;
   SELECT s.organization_id,s.center_id,s.sale_number INTO v_org,v_center,v_number
     FROM public.sales_orders s WHERE s.id=NEW.sales_order_id;
   IF v_org IS NULL THEN RAISE EXCEPTION 'Sales bank payment not linked to an order'; END IF;
   v_created_by:=NULL;
   v_direction:='debit';v_description:='Sales bank transfer';
 ELSE
   RAISE EXCEPTION 'Unexpected bank payment trigger source';
 END IF;
 v_description:=v_description||' · '||coalesce((SELECT c.code||' · '||c.name FROM public.centers c
   WHERE c.id=v_center),'Unknown center');
 SELECT organization_id INTO v_account_org FROM public.bank_accounts WHERE id=NEW.bank_account_id;
 IF v_account_org IS NULL OR v_account_org<>v_org THEN
   RAISE EXCEPTION 'Bank account must belong to the same organization'; END IF;
 INSERT INTO public.bank_book_entries
 (organization_id,bank_account_id,center_id,direction,amount,source_table,source_id,description,reference,created_at,created_by)
 VALUES(v_org,NEW.bank_account_id,v_center,v_direction,NEW.amount,TG_TABLE_NAME,NEW.id,
   v_description||' · '||v_number,coalesce(nullif(trim(NEW.reference),''),v_number),
   NEW.created_at,v_created_by)
 ON CONFLICT(source_table,source_id) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payments_bank_book_post ON public.payments;
CREATE TRIGGER payments_bank_book_post AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.bank_book_post_payment();
DROP TRIGGER IF EXISTS sales_payments_bank_book_post ON public.sales_payments;
CREATE TRIGGER sales_payments_bank_book_post AFTER INSERT ON public.sales_payments
FOR EACH ROW EXECUTE FUNCTION public.bank_book_post_payment();

-- Backfill past bank payments without changing original purchase/sale rows.
INSERT INTO public.bank_book_entries
 (organization_id,bank_account_id,center_id,direction,amount,source_table,source_id,description,reference,created_at,created_by)
SELECT p.organization_id,p.bank_account_id,p.center_id,'credit',p.amount,'payments',p.id,
 CASE WHEN p.method::text='card' THEN 'Purchase card payment' ELSE 'Purchase bank transfer' END||' · '||c.code||' · '||c.name||' · '||po.po_number,
 coalesce(nullif(trim(p.reference),''),po.po_number),p.created_at,p.created_by
FROM public.payments p JOIN public.purchase_orders po ON po.id=p.purchase_order_id
 JOIN public.centers c ON c.id=p.center_id
 JOIN public.bank_accounts a ON a.id=p.bank_account_id AND a.organization_id=p.organization_id
WHERE p.method::text IN ('bank_transfer','card') AND p.bank_account_id IS NOT NULL
ON CONFLICT(source_table,source_id) DO NOTHING;
INSERT INTO public.bank_book_entries
 (organization_id,bank_account_id,center_id,direction,amount,source_table,source_id,description,reference,created_at)
SELECT so.organization_id,p.bank_account_id,so.center_id,'debit',p.amount,'sales_payments',p.id,
 'Sales bank transfer · '||c.code||' · '||c.name||' · '||so.sale_number,coalesce(nullif(trim(p.reference),''),so.sale_number),p.created_at
FROM public.sales_payments p JOIN public.sales_orders so ON so.id=p.sales_order_id
 JOIN public.centers c ON c.id=so.center_id
 JOIN public.bank_accounts a ON a.id=p.bank_account_id AND a.organization_id=so.organization_id
WHERE p.method::text='bank_transfer' AND p.bank_account_id IS NOT NULL
ON CONFLICT(source_table,source_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bank_book_balance(p_bank_account uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;v_balance numeric;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
 SELECT organization_id INTO v_org FROM public.bank_accounts WHERE id=p_bank_account;
 IF v_org IS NULL OR v_org<>(public.current_profile()).organization_id THEN RAISE EXCEPTION 'Bank account access denied'; END IF;
 SELECT coalesce(sum(CASE WHEN direction='debit' THEN amount ELSE -amount END),0)
 INTO v_balance FROM public.bank_book_entries WHERE bank_account_id=p_bank_account;
 RETURN v_balance::numeric(18,2);
END $$;

CREATE OR REPLACE FUNCTION public.record_admin_bank_funding(
 p_bank_account uuid,p_amount numeric,p_source text,p_details text,p_reference text,p_request uuid,
 p_value_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;v_id uuid;v_existing public.bank_fundings%rowtype;v_user uuid:=auth.uid();
 v_posted_at timestamptz;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admins may fund bank accounts'; END IF;
 v_org:=(public.current_profile()).organization_id;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>=1000000000000 OR p_amount<>round(p_amount,2)
    OR nullif(trim(coalesce(p_source,'')),'') IS NULL
    OR nullif(trim(coalesce(p_details,'')),'') IS NULL
    OR length(p_source)>80 OR length(p_details)>500 OR length(coalesce(p_reference,''))>120
    OR p_request IS NULL THEN RAISE EXCEPTION 'Enter valid amount, source, description and request ID'; END IF;
 -- Repeated submission must not create a second bank deposit.
 SELECT * INTO v_existing FROM public.bank_fundings WHERE request_id=p_request;
 IF FOUND THEN
   IF v_existing.organization_id<>v_org OR v_existing.bank_account_id<>p_bank_account OR v_existing.amount<>p_amount THEN
     RAISE EXCEPTION 'Duplicate request ID used for another bank funding'; END IF;
   RETURN v_existing.id;
 END IF;
 IF p_value_date IS NOT NULL AND p_value_date>(now() AT TIME ZONE 'Asia/Colombo')::date THEN
   RAISE EXCEPTION 'Bank posting date cannot be in the future'; END IF;
 v_posted_at:=CASE WHEN p_value_date IS NULL THEN now()
                    ELSE p_value_date::timestamp AT TIME ZONE 'Asia/Colombo' END;
 IF NOT EXISTS(SELECT 1 FROM public.bank_accounts WHERE id=p_bank_account
   AND organization_id=v_org AND is_active) THEN RAISE EXCEPTION 'Select active company bank account'; END IF;
 INSERT INTO public.bank_fundings(request_id,organization_id,bank_account_id,amount,source,details,reference,posting_date,created_by)
 VALUES(p_request,v_org,p_bank_account,p_amount,trim(p_source),trim(p_details),nullif(trim(p_reference),''),v_posted_at,v_user)
 RETURNING id INTO v_id;
 INSERT INTO public.bank_book_entries(organization_id,bank_account_id,direction,amount,source_table,source_id,description,reference,created_at,created_by)
 VALUES(v_org,p_bank_account,'debit',p_amount,'bank_fundings',v_id,
  'Admin bank funding · '||trim(p_source)||' · '||trim(p_details),nullif(trim(p_reference),''),v_posted_at,v_user);
 INSERT INTO public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
 VALUES(v_org,v_user,'bank_funding_added','bank_funding',v_id::text,
   jsonb_build_object('bank_account_id',p_bank_account,'amount',p_amount,'source',p_source,'reference',p_reference));
 RETURN v_id;
END $$;

-- Statement balance includes ALL centers even when one center is filtered.
CREATE OR REPLACE FUNCTION public.company_bank_statement(
 p_bank_account uuid,p_center uuid DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL,
 p_limit integer DEFAULT 51,p_offset integer DEFAULT 0)
RETURNS TABLE(entry_id uuid,posted_at timestamptz,center_name text,description text,
 reference text,debit numeric,credit numeric,running_balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required'; END IF;
 v_org:=(public.current_profile()).organization_id;
 IF NOT EXISTS(SELECT 1 FROM public.bank_accounts WHERE id=p_bank_account AND organization_id=v_org) THEN
   RAISE EXCEPTION 'Bank account not found'; END IF;
 IF p_center IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.centers WHERE id=p_center AND organization_id=v_org) THEN
   RAISE EXCEPTION 'Invalid center filter'; END IF;
 IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to THEN RAISE EXCEPTION 'Invalid date range'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>200 OR p_offset IS NULL OR p_offset<0 OR p_offset>1000000 THEN
   RAISE EXCEPTION 'Invalid page size or offset'; END IF;
 RETURN QUERY WITH posted AS (
   SELECT e.id,e.created_at,e.center_id,e.description,e.reference,e.direction,e.amount,
    sum(CASE WHEN e.direction='debit' THEN e.amount ELSE -e.amount END)
      OVER(ORDER BY e.created_at,e.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS bal
   FROM public.bank_book_entries e WHERE e.bank_account_id=p_bank_account AND e.organization_id=v_org
 ), page AS (
   SELECT p.* FROM posted p WHERE (p_center IS NULL OR p.center_id=p_center)
     AND (p_from IS NULL OR (p.created_at AT TIME ZONE 'Asia/Colombo')::date>=p_from)
     AND (p_to IS NULL OR (p.created_at AT TIME ZONE 'Asia/Colombo')::date<=p_to)
   ORDER BY p.created_at,p.id LIMIT p_limit OFFSET p_offset
 )
 SELECT p.id,p.created_at,coalesce(c.code||' · '||c.name,'Admin / Company')::text,
   p.description,p.reference,
   CASE WHEN p.direction='debit' THEN p.amount ELSE 0::numeric END,
   CASE WHEN p.direction='credit' THEN p.amount ELSE 0::numeric END,p.bal
 FROM page p LEFT JOIN public.centers c ON c.id=p.center_id
 ORDER BY p.created_at,p.id;
END $$;

REVOKE ALL ON FUNCTION public.bank_accounts_validate_company() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bank_book_post_payment() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bank_book_reject_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bank_book_post_contra() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bank_contra_reject_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_admin_bank_funding(uuid,numeric,text,text,text,uuid,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bank_book_balance(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.company_bank_statement(uuid,uuid,date,date,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_admin_bank_funding(uuid,numeric,text,text,text,uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bank_book_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_bank_statement(uuid,uuid,date,date,integer,integer) TO authenticated;
COMMIT;
