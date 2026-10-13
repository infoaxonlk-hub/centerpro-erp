-- CenterPro 039 | ONE cash account per center + admin main cash; append-only balanced postings.
-- Prerequisite: migrations through 038, including 031_unified_cash_float.sql.
-- NO existing purchases, sales, cash ledger, handovers, users or balances are deleted.
-- This file is intentionally additive/idempotent for one-time SQL Editor deployment.
BEGIN;

DO $$ BEGIN
 IF to_regclass('public.admin_cash_in') IS NULL OR to_regclass('public.center_cash_issues') IS NULL
    OR to_regclass('public.expense_cash_ledger') IS NULL THEN
   RAISE EXCEPTION 'STOP: Run required pre-039 migrations first (015 and 031).';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cash_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 center_id uuid REFERENCES public.centers(id),
 kind text NOT NULL CHECK(kind IN ('admin_main','center','in_transit','clearing','variance')),
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='center') = (center_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_accounts_identity_key ON public.cash_accounts
 (organization_id,kind,coalesce(center_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS cash_accounts_org_idx ON public.cash_accounts(organization_id);

-- Each record names ONE debit account and ONE credit account for the same amount.
-- Such a record is balanced by construction (rather than independently-editable debit/credit lines).
CREATE TABLE IF NOT EXISTS public.cash_account_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 debit_account_id uuid NOT NULL REFERENCES public.cash_accounts(id),
 credit_account_id uuid NOT NULL REFERENCES public.cash_accounts(id),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 source_table text NOT NULL,
 source_id uuid NOT NULL,
 posting_key text NOT NULL DEFAULT 'posted',
 note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT cash_account_entries_distinct CHECK(debit_account_id<>credit_account_id),
 CONSTRAINT cash_account_entries_source_uk UNIQUE(source_table,source_id,posting_key)
);
CREATE INDEX IF NOT EXISTS cash_account_entries_debit_idx ON public.cash_account_entries(debit_account_id,created_at DESC);
CREATE INDEX IF NOT EXISTS cash_account_entries_credit_idx ON public.cash_account_entries(credit_account_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_cash_accounts(p_org uuid,p_center uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_name text;
BEGIN
 IF p_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org) THEN
   RAISE EXCEPTION 'Invalid organization';
 END IF;
 INSERT INTO public.cash_accounts(organization_id,kind,name)
 VALUES(p_org,'admin_main','Admin Main Cash'),(p_org,'in_transit','Cash In Transit'),
       (p_org,'clearing','Cash Activity Clearing'),(p_org,'variance','Cash Difference Control')
 ON CONFLICT DO NOTHING;
 IF p_center IS NOT NULL THEN
   SELECT code||' · '||name INTO v_name FROM public.centers
   WHERE id=p_center AND organization_id=p_org;
   IF v_name IS NULL THEN RAISE EXCEPTION 'Center does not belong to organization'; END IF;
   INSERT INTO public.cash_accounts(organization_id,center_id,kind,name)
   VALUES(p_org,p_center,'center',v_name||' Cash') ON CONFLICT DO NOTHING;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cash_accounts_auto_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.ensure_cash_accounts(NEW.organization_id,NEW.id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS center_auto_cash_account ON public.centers;
CREATE TRIGGER center_auto_cash_account AFTER INSERT ON public.centers
FOR EACH ROW EXECUTE FUNCTION public.cash_accounts_auto_create();

-- Ensure existing centers have accounts; preserves all existing cash movement rows.
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT id FROM public.organizations LOOP PERFORM public.ensure_cash_accounts(r.id); END LOOP;
 FOR r IN SELECT organization_id,id FROM public.centers LOOP PERFORM public.ensure_cash_accounts(r.organization_id,r.id); END LOOP;
END $$;

-- Internal journal writer: callers are triggers only; not granted to authenticated/anon.
CREATE OR REPLACE FUNCTION public.cash_post_entry(
 p_org uuid,p_debit_kind text,p_credit_kind text,p_center uuid,
 p_amount numeric,p_source_table text,p_source_id uuid,p_key text,p_note text,p_date timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_debit uuid;v_credit uuid;
BEGIN
 IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Journal amount must be positive'; END IF;
 PERFORM public.ensure_cash_accounts(p_org,p_center);
 -- Serialize center cash outflows to prevent two concurrent payments overspending.
 IF p_credit_kind='center' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(p_center::text, 391));
   IF (SELECT coalesce(sum(CASE WHEN e.debit_account_id=a.id THEN e.amount ELSE -e.amount END),0)
       FROM public.cash_accounts a LEFT JOIN public.cash_account_entries e
         ON e.debit_account_id=a.id OR e.credit_account_id=a.id
       WHERE a.organization_id=p_org AND a.kind='center' AND a.center_id=p_center)
      < round(p_amount,2) THEN
      RAISE EXCEPTION 'Insufficient center cash account balance';
   END IF;
 END IF;
 SELECT id INTO v_debit FROM public.cash_accounts
 WHERE organization_id=p_org AND kind=p_debit_kind AND (kind<>'center' OR center_id=p_center);
 SELECT id INTO v_credit FROM public.cash_accounts
 WHERE organization_id=p_org AND kind=p_credit_kind AND (kind<>'center' OR center_id=p_center);
 IF v_debit IS NULL OR v_credit IS NULL OR v_debit=v_credit THEN
   RAISE EXCEPTION 'Unbalanced or missing cash accounts';
 END IF;
 INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
 VALUES(p_org,v_debit,v_credit,round(p_amount,2),p_source_table,p_source_id,p_key,p_note,coalesce(p_date,now()))
 ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;
END $$;

-- Activity in the existing purchase/sale cash ledger is mirrored, not replaced.
CREATE OR REPLACE FUNCTION public.cash_ledger_to_account_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.movement_type IN ('allocation','refund','sale_receipt') THEN
   PERFORM public.cash_post_entry(NEW.organization_id,'center','clearing',NEW.center_id,NEW.amount,'cash_ledger',NEW.id,'posted',NEW.note,NEW.created_at);
 ELSE
   PERFORM public.cash_post_entry(NEW.organization_id,'clearing','center',NEW.center_id,NEW.amount,'cash_ledger',NEW.id,'posted',NEW.note,NEW.created_at);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cash_ledger_cash_accounts ON public.cash_ledger;
CREATE TRIGGER cash_ledger_cash_accounts AFTER INSERT ON public.cash_ledger
FOR EACH ROW EXECUTE FUNCTION public.cash_ledger_to_account_entry();

CREATE OR REPLACE FUNCTION public.expense_cash_ledger_to_account_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.movement_type IN ('allocation','adjustment') THEN
   PERFORM public.cash_post_entry(NEW.organization_id,'center','clearing',NEW.center_id,NEW.amount,'expense_cash_ledger',NEW.id,'posted',NEW.note,NEW.created_at);
 ELSE
   PERFORM public.cash_post_entry(NEW.organization_id,'clearing','center',NEW.center_id,NEW.amount,'expense_cash_ledger',NEW.id,'posted',NEW.note,NEW.created_at);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS expense_ledger_cash_accounts ON public.expense_cash_ledger;
CREATE TRIGGER expense_ledger_cash_accounts AFTER INSERT ON public.expense_cash_ledger
FOR EACH ROW EXECUTE FUNCTION public.expense_cash_ledger_to_account_entry();

CREATE OR REPLACE FUNCTION public.admin_cash_in_to_account_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.cash_post_entry(NEW.organization_id,'admin_main','clearing',NULL,NEW.amount,'admin_cash_in',NEW.id,'posted',NEW.source||': '||NEW.source_details,NEW.created_at);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admin_cash_in_cash_accounts ON public.admin_cash_in;
CREATE TRIGGER admin_cash_in_cash_accounts AFTER INSERT ON public.admin_cash_in
FOR EACH ROW EXECUTE FUNCTION public.admin_cash_in_to_account_entry();

-- A cash issue moves money out of Admin Main immediately into Cash In Transit.
-- On confirmed receipt, Cash In Transit clears to Cash Activity Clearing,
-- then the existing purchasing/expense ledgers add the physical cash to Center Cash.
CREATE OR REPLACE FUNCTION public.center_cash_issue_to_account_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_issued numeric(18,2); v_received numeric(18,2);
BEGIN
 v_issued := NEW.purchase_issued+NEW.expense_issued;
 IF TG_OP='INSERT' THEN
   PERFORM public.cash_post_entry(NEW.organization_id,'in_transit','admin_main',NULL,v_issued,'center_cash_issues',NEW.id,'issued','Issue: '||NEW.reference,NEW.issued_at);
   IF NEW.status='received' THEN
     v_received:=NEW.purchase_received+NEW.expense_received;
   ELSE RETURN NEW; END IF;
 ELSE
   IF OLD.status<>'pending' OR NEW.status<>'received' THEN RETURN NEW; END IF;
   v_received:=NEW.purchase_received+NEW.expense_received;
 END IF;
 IF least(v_issued,v_received)>0 THEN
   PERFORM public.cash_post_entry(NEW.organization_id,'clearing','in_transit',NULL,least(v_issued,v_received),'center_cash_issues',NEW.id,'received','Receipt: '||NEW.reference,NEW.received_at);
 END IF;
 IF v_received<v_issued THEN
   PERFORM public.cash_post_entry(NEW.organization_id,'variance','in_transit',NULL,v_issued-v_received,'center_cash_issues',NEW.id,'short','Cash shortage: '||NEW.reference,NEW.received_at);
 ELSIF v_received>v_issued THEN
   PERFORM public.cash_post_entry(NEW.organization_id,'clearing','variance',NULL,v_received-v_issued,'center_cash_issues',NEW.id,'over','Cash overage: '||NEW.reference,NEW.received_at);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS combined_cash_issue_cash_accounts_insert ON public.center_cash_issues;
CREATE TRIGGER combined_cash_issue_cash_accounts_insert AFTER INSERT ON public.center_cash_issues
FOR EACH ROW EXECUTE FUNCTION public.center_cash_issue_to_account_entry();
DROP TRIGGER IF EXISTS combined_cash_issue_cash_accounts_update ON public.center_cash_issues;
CREATE TRIGGER combined_cash_issue_cash_accounts_update AFTER UPDATE OF status ON public.center_cash_issues
FOR EACH ROW EXECUTE FUNCTION public.center_cash_issue_to_account_entry();

-- Backfill existing historical postings without touching source or balances.
INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
SELECT l.organization_id,
 CASE WHEN l.movement_type IN ('allocation','refund','sale_receipt') THEN c.id ELSE x.id END,
 CASE WHEN l.movement_type IN ('allocation','refund','sale_receipt') THEN x.id ELSE c.id END,
 l.amount,'cash_ledger',l.id,'posted',l.note,l.created_at
FROM public.cash_ledger l
JOIN public.cash_accounts c ON c.organization_id=l.organization_id AND c.center_id=l.center_id AND c.kind='center'
JOIN public.cash_accounts x ON x.organization_id=l.organization_id AND x.kind='clearing'
ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;
INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
SELECT l.organization_id,
 CASE WHEN l.movement_type IN ('allocation','adjustment') THEN c.id ELSE x.id END,
 CASE WHEN l.movement_type IN ('allocation','adjustment') THEN x.id ELSE c.id END,
 l.amount,'expense_cash_ledger',l.id,'posted',l.note,l.created_at
FROM public.expense_cash_ledger l
JOIN public.cash_accounts c ON c.organization_id=l.organization_id AND c.center_id=l.center_id AND c.kind='center'
JOIN public.cash_accounts x ON x.organization_id=l.organization_id AND x.kind='clearing'
ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;
INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
SELECT i.organization_id,a.id,x.id,i.amount,'admin_cash_in',i.id,'posted',i.source||': '||i.source_details,i.created_at
FROM public.admin_cash_in i
JOIN public.cash_accounts a ON a.organization_id=i.organization_id AND a.kind='admin_main'
JOIN public.cash_accounts x ON x.organization_id=i.organization_id AND x.kind='clearing'
ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;

-- Backfill combined handovers, including those awaiting receipt.
INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
SELECT i.organization_id,t.id,a.id,i.purchase_issued+i.expense_issued,'center_cash_issues',i.id,'issued','Issue: '||i.reference,i.issued_at
FROM public.center_cash_issues i
JOIN public.cash_accounts a ON a.organization_id=i.organization_id AND a.kind='admin_main'
JOIN public.cash_accounts t ON t.organization_id=i.organization_id AND t.kind='in_transit'
ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;
INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
SELECT i.organization_id,x.id,t.id,least(i.purchase_issued+i.expense_issued,i.purchase_received+i.expense_received),
 'center_cash_issues',i.id,'received','Receipt: '||i.reference,i.received_at
FROM public.center_cash_issues i
JOIN public.cash_accounts t ON t.organization_id=i.organization_id AND t.kind='in_transit'
JOIN public.cash_accounts x ON x.organization_id=i.organization_id AND x.kind='clearing'
WHERE i.status='received' AND least(i.purchase_issued+i.expense_issued,i.purchase_received+i.expense_received)>0
ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;
INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
SELECT i.organization_id,v.id,t.id,(i.purchase_issued+i.expense_issued)-(i.purchase_received+i.expense_received),
 'center_cash_issues',i.id,'short','Cash shortage: '||i.reference,i.received_at
FROM public.center_cash_issues i
JOIN public.cash_accounts t ON t.organization_id=i.organization_id AND t.kind='in_transit'
JOIN public.cash_accounts v ON v.organization_id=i.organization_id AND v.kind='variance'
WHERE i.status='received' AND i.purchase_issued+i.expense_issued > i.purchase_received+i.expense_received
ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;
INSERT INTO public.cash_account_entries(organization_id,debit_account_id,credit_account_id,amount,source_table,source_id,posting_key,note,created_at)
SELECT i.organization_id,x.id,v.id,(i.purchase_received+i.expense_received)-(i.purchase_issued+i.expense_issued),
 'center_cash_issues',i.id,'over','Cash overage: '||i.reference,i.received_at
FROM public.center_cash_issues i
JOIN public.cash_accounts x ON x.organization_id=i.organization_id AND x.kind='clearing'
JOIN public.cash_accounts v ON v.organization_id=i.organization_id AND v.kind='variance'
WHERE i.status='received' AND i.purchase_received+i.expense_received > i.purchase_issued+i.expense_issued
ON CONFLICT(source_table,source_id,posting_key) DO NOTHING;

-- Account balances are derived from posted debits minus posted credits.
CREATE OR REPLACE FUNCTION public.cash_account_balance(p_account uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account public.cash_accounts%rowtype; v_amount numeric;
BEGIN
 SELECT * INTO v_account FROM public.cash_accounts WHERE id=p_account;
 IF NOT FOUND OR v_account.organization_id IS DISTINCT FROM (public.current_profile()).organization_id OR
    NOT (public.is_admin() OR (v_account.kind='center' AND public.can_access_center(v_account.center_id))) THEN
   RAISE EXCEPTION 'Cash account access denied';
 END IF;
 SELECT coalesce(sum(CASE WHEN debit_account_id=p_account THEN amount ELSE -amount END),0)
 INTO v_amount FROM public.cash_account_entries WHERE debit_account_id=p_account OR credit_account_id=p_account;
 RETURN v_amount::numeric(18,2);
END $$;

-- This is now the authoritative available ADMIN balance for new transfers.
-- Pending cash is already debited out of Admin Main (held in Transit).
CREATE OR REPLACE FUNCTION public.cash_float_available()
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT id INTO v_id FROM public.cash_accounts
 WHERE organization_id=(public.current_profile()).organization_id AND kind='admin_main';
 IF v_id IS NULL THEN RAISE EXCEPTION 'Admin cash account not found'; END IF;
 RETURN public.cash_account_balance(v_id);
END $$;

-- Existing purchase and expense validations now use the SAME physical center cash account.
CREATE OR REPLACE FUNCTION public.center_cash_balance(target_center uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 SELECT id INTO v_id FROM public.cash_accounts WHERE kind='center' AND center_id=target_center;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Center cash account not found'; END IF;
 RETURN public.cash_account_balance(v_id);
END $$;
CREATE OR REPLACE FUNCTION public.center_expense_cash_balance(target_center uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.center_cash_balance(target_center);
$$;

-- Make receipt differences auditable. Existing 3-argument RPC stays available
-- for exact receipts; new clients send a note via the 4-argument RPC.
ALTER TABLE public.center_cash_issues ADD COLUMN IF NOT EXISTS receipt_note text;
CREATE OR REPLACE FUNCTION public.receive_center_cash_with_note(p_issue uuid,p_purchase numeric,p_expense numeric,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.center_cash_issues%rowtype;v_actor public.profiles%rowtype;v_purchase numeric(18,2);v_expense numeric(18,2);
BEGIN
 SELECT * INTO v_actor FROM public.profiles WHERE id=auth.uid() AND is_active;
 IF v_actor.id IS NULL OR v_actor.role NOT IN ('admin','super_admin','center_user') THEN
   RAISE EXCEPTION 'Only an active admin or center user can receive cash'; END IF;
 SELECT * INTO v_row FROM public.center_cash_issues WHERE id=p_issue FOR UPDATE;
 IF NOT FOUND OR v_row.organization_id<>v_actor.organization_id OR NOT public.can_access_center(v_row.center_id) THEN
   RAISE EXCEPTION 'Cash issue not found'; END IF;
 IF v_row.status<>'pending' THEN RAISE EXCEPTION 'Cash issue has already been received'; END IF;
 IF p_purchase IS NULL OR p_expense IS NULL OR p_purchase<0 OR p_expense<0 OR
    round(p_purchase,2)<>p_purchase OR round(p_expense,2)<>p_expense THEN
   RAISE EXCEPTION 'Enter valid receipt amounts (2 decimal places)'; END IF;
 v_purchase:=p_purchase; v_expense:=p_expense;
 IF (v_purchase<>v_row.purchase_issued OR v_expense<>v_row.expense_issued)
    AND nullif(trim(coalesce(p_note,'')),'') IS NULL THEN
   RAISE EXCEPTION 'A reason is required for a cash receipt difference';
 END IF;
 UPDATE public.center_cash_issues SET purchase_received=v_purchase,expense_received=v_expense,status='received',receipt_note=nullif(trim(p_note),''),received_by=auth.uid(),received_at=now()
 WHERE id=p_issue;
 -- The legacy cash ledgers continue to drive purchases and expense validations.
 IF v_purchase>0 THEN INSERT INTO public.cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by)
   VALUES(v_row.organization_id,v_row.center_id,'allocation',v_purchase,'combined_cash_issue',p_issue,'Purchasing cash received: '||v_row.reference,auth.uid()); END IF;
 IF v_expense>0 THEN INSERT INTO public.expense_cash_ledger(organization_id,center_id,movement_type,amount,reference_type,reference_id,note,created_by)
   VALUES(v_row.organization_id,v_row.center_id,'allocation',v_expense,'combined_cash_issue',p_issue,'Expense cash received: '||v_row.reference,auth.uid()); END IF;
 INSERT INTO public.notifications(organization_id,type,title,message,center_id,reference_id,audience)
 VALUES(v_row.organization_id,CASE WHEN v_purchase<>v_row.purchase_issued OR v_expense<>v_row.expense_issued THEN 'cash_difference' ELSE 'cash_received' END,
 'Center cash received','Issued purchasing '||v_row.purchase_issued||', expense '||v_row.expense_issued||'; received purchasing '||v_purchase||', expense '||v_expense||'.',v_row.center_id,p_issue,'admin');
 INSERT INTO public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
 VALUES(v_row.organization_id,auth.uid(),'combined_cash_received','center_cash_issue',p_issue::text,jsonb_build_object('purchase_received',v_purchase,'expense_received',v_expense,'receipt_note',nullif(trim(p_note),'')));
END $$;

-- Compatible existing RPC; it can confirm matching amounts without needing a note.
CREATE OR REPLACE FUNCTION public.receive_combined_center_cash(p_issue uuid,p_purchase numeric,p_expense numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.receive_center_cash_with_note(p_issue,p_purchase,p_expense,NULL);
END $$;

-- Stop NEW issuance through legacy endpoints; old pending legacy receipts remain processable.
CREATE OR REPLACE FUNCTION public.issue_center_cash(target_center uuid,issue_amount numeric,issue_reference text,issue_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Use Cash & Payments > Admin Main Cash > Issue to center'; END $$;
CREATE OR REPLACE FUNCTION public.issue_center_expense_cash(target_center uuid,issue_amount numeric,issue_reference text,issue_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Use Cash & Payments > Admin Main Cash > Issue to center'; END $$;

-- Prevent new center cash additions bypassing Admin Main; historical approvals remain supported.
CREATE OR REPLACE FUNCTION public.request_center_cash_topup(p_center uuid,p_amount numeric,p_reference text,p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'New funding must be recorded in Admin Main Cash and transferred to the center'; END $$;

-- Read-only to the app; triggers/service-side functions write journal, never the browser.
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_account_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_accounts_visibility ON public.cash_accounts;
CREATE POLICY cash_accounts_visibility ON public.cash_accounts FOR SELECT TO authenticated
 USING(organization_id=(public.current_profile()).organization_id AND
   (public.is_admin() OR (kind='center' AND public.can_access_center(center_id))));
DROP POLICY IF EXISTS cash_entries_visibility ON public.cash_account_entries;
CREATE POLICY cash_entries_visibility ON public.cash_account_entries FOR SELECT TO authenticated
 USING(organization_id=(public.current_profile()).organization_id AND (public.is_admin() OR EXISTS (
 SELECT 1 FROM public.cash_accounts c WHERE c.organization_id=organization_id AND c.kind='center'
   AND c.center_id IS NOT NULL AND public.can_access_center(c.center_id)
   AND (c.id=debit_account_id OR c.id=credit_account_id))));
REVOKE ALL ON public.cash_accounts,public.cash_account_entries FROM anon,authenticated;
GRANT SELECT ON public.cash_accounts,public.cash_account_entries TO authenticated;
REVOKE ALL ON FUNCTION public.ensure_cash_accounts(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cash_post_entry(uuid,text,text,uuid,numeric,text,uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cash_accounts_auto_create() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cash_ledger_to_account_entry() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.expense_cash_ledger_to_account_entry() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_cash_in_to_account_entry() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.center_cash_issue_to_account_entry() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cash_account_balance(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cash_account_balance(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cash_float_available() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cash_float_available() TO authenticated;
REVOKE ALL ON FUNCTION public.receive_center_cash_with_note(uuid,numeric,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_center_cash_with_note(uuid,numeric,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.receive_combined_center_cash(uuid,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_combined_center_cash(uuid,numeric,numeric) TO authenticated;

COMMIT;
