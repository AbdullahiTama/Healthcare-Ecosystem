-- POS accounting: who handled each sale, optional shifts, and a payments ledger.
--
-- Design: docs/superpowers/specs/2026-10-25-pos-sales-report-design.md
-- Docs:   docs/architecture/POS-Sales-Report.md
--
-- Why: the Sales & Accounts report needs facts the POS never recorded.
--   * No sale carried its cashier (sales.staff_name existed; 3 of 120 rows set).
--   * A credit collection overwrote the original sale's amount_paid, so money
--     received could not be placed on the day it arrived.
--   * There was no POS refund and no shift.
--
-- What this adds:
--   1. pos_shifts + open_pos_shift() / close_pos_shift(). Shifts are optional.
--   2. sales.cashier_user_id / cashier_staff_id / shift_id / refunded_amount,
--      stamped by a BEFORE INSERT trigger from the caller's own session. A
--      value sent by the client is overwritten, so the cashier cannot be forged.
--   3. sale_payments, an append-only ledger of money in (sale, collection) and
--      out (refund). Written only by the sales insert trigger and the two
--      functions below; clients may only read their own business's rows.
--   4. record_sale_payment(): a credit collection, atomically on the ledger, the
--      sale and its credit_sale debt.
--   5. refund_sale(): owner or manager only; money only (no restock).
--   6. Backfill: one ledger row per existing completed sale.
--   7. record_export_audit() learns the sales-report Excel export type.
--
-- "Completed sale" everywhere below: NOT is_on_hold AND status IS NULL or
-- 'completed'. Held, resumed-but-abandoned and deleted rows are not sales.
--
-- Money received at the till is least(amount_paid, total): the cash path
-- stores the cash TENDERED in amount_paid, so change handed back must not be
-- counted (1 live row had amount_paid > total on 2026-10-25).
--
-- APPLIED to production 2026-10-26 (schema_migrations 20261026221943).
-- Re-runnable. Apply as a tracked migration, then run the verification block
-- in docs/architecture/POS-Sales-Report.md (ACL re-check: Supabase re-grants
-- EXECUTE to anon at creation time even after REVOKE FROM PUBLIC).
--
-- Depends on: sales, debts, staff(auth_user_id, email, status, role, full_name),
--   businesses(email, owner_name, owner, parent_business_id), current_business_ids(),
--   is_business_manager(uuid), audit_log (carehub_20260810), record_export_audit (carehub_20261209).
--
-- Rollback (in order):
--   DROP TRIGGER IF EXISTS sales_record_payments ON public.sales;
--   DROP TRIGGER IF EXISTS sales_stamp_actor ON public.sales;
--   DROP FUNCTION IF EXISTS public.refund_sale(uuid, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.record_sale_payment(uuid, numeric, text);
--   DROP FUNCTION IF EXISTS public.close_pos_shift(uuid, numeric, text);
--   DROP FUNCTION IF EXISTS public.open_pos_shift(uuid, numeric);
--   DROP FUNCTION IF EXISTS public.sales_record_payments_on_insert();
--   DROP FUNCTION IF EXISTS public.sales_stamp_actor();
--   DROP FUNCTION IF EXISTS public.pos_split_payments(jsonb, text, numeric);
--   DROP FUNCTION IF EXISTS public.pos_actor(uuid);
--   DROP TABLE IF EXISTS public.sale_payments;
--   ALTER TABLE public.sales DROP COLUMN IF EXISTS shift_id, DROP COLUMN IF EXISTS cashier_user_id,
--     DROP COLUMN IF EXISTS cashier_staff_id, DROP COLUMN IF EXISTS refunded_amount;
--   DROP TABLE IF EXISTS public.pos_shifts;
--   then re-apply carehub_20261209_record_export_audit.sql to restore the old allow-list.

-- ---------------------------------------------------------------------------
-- 1. Shifts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL,
  staff_id uuid,
  staff_name text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_float numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  closed_at timestamptz,
  closed_by uuid,
  closed_by_name text,
  counted_cash numeric(14,2) CHECK (counted_cash >= 0),
  expected_cash numeric(14,2),
  close_note text CHECK (close_note IS NULL OR length(close_note) <= 500),
  CONSTRAINT pos_shifts_close_complete CHECK ((closed_at IS NULL) = (counted_cash IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_user
  ON public.pos_shifts (business_id, opened_by) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS pos_shifts_business_opened ON public.pos_shifts (business_id, opened_at DESC);

ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_shifts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pos_shifts TO authenticated;
DROP POLICY IF EXISTS "pos_shifts readable by own business" ON public.pos_shifts;
CREATE POLICY "pos_shifts readable by own business" ON public.pos_shifts
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT public.current_business_ids()));

-- ---------------------------------------------------------------------------
-- 2. Sale columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cashier_user_id uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cashier_staff_id uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.pos_shifts(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refunded_amount numeric(14,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.sales ADD CONSTRAINT sales_refunded_amount_nonneg CHECK (refunded_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS sales_business_created ON public.sales (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_shift ON public.sales (shift_id) WHERE shift_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Payments ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sale', 'collection', 'refund')),
  -- 'Unspecified' is honest about history: older credit deposits never
  -- recorded how they were paid. New rows always carry a real method.
  method text NOT NULL CHECK (method IN ('Cash', 'Transfer', 'POS', 'Unspecified')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid,
  staff_id uuid,
  staff_name text,
  shift_id uuid REFERENCES public.pos_shifts(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR length(note) <= 300),
  backfilled boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sale_payments_business_received ON public.sale_payments (business_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sale_payments_sale ON public.sale_payments (sale_id);
CREATE INDEX IF NOT EXISTS sale_payments_shift ON public.sale_payments (shift_id) WHERE shift_id IS NOT NULL;

ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sale_payments TO authenticated;
DROP POLICY IF EXISTS "sale_payments readable by own business" ON public.sale_payments;
CREATE POLICY "sale_payments readable by own business" ON public.sale_payments
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT public.current_business_ids()));

-- A payment row is a fact about money that moved. Corrections are new rows
-- (a refund), never edits — not even by the table owner.
CREATE OR REPLACE FUNCTION public.sale_payments_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  RAISE EXCEPTION 'sale_payments is append-only: record a refund instead of editing a payment';
END $$;
DROP TRIGGER IF EXISTS sale_payments_no_update ON public.sale_payments;
CREATE TRIGGER sale_payments_no_update BEFORE UPDATE ON public.sale_payments
  FOR EACH ROW EXECUTE FUNCTION public.sale_payments_append_only();

-- ---------------------------------------------------------------------------
-- 4. Who is the caller, for this business?
-- ---------------------------------------------------------------------------
-- Internal helper. Membership is current_business_ids(), which includes the
-- branches below any business the caller owns or works at, so the identity is
-- looked up across the business and its ancestors: the nearest staff row
-- first (by auth user id, then by email), then the nearest owner. Returns no
-- row for a non-member.
CREATE OR REPLACE FUNCTION public.pos_actor(p_business_id uuid)
RETURNS TABLE (user_id uuid, staff_id uuid, staff_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(auth.email());
BEGIN
  IF v_uid IS NULL OR p_business_id IS NULL
     OR p_business_id NOT IN (SELECT public.current_business_ids()) THEN
    RETURN;
  END IF;

  RETURN QUERY
    WITH RECURSIVE up(id, parent_business_id, depth) AS (
      SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
      UNION
      SELECT p.id, p.parent_business_id, up.depth + 1
        FROM public.businesses p JOIN up ON p.id = up.parent_business_id
       WHERE up.depth < 10
    )
    SELECT v_uid, s.id, COALESCE(NULLIF(trim(s.full_name), ''), s.email)
      FROM up JOIN public.staff s ON s.business_id = up.id
     WHERE s.status = 'active'
       AND (s.auth_user_id = v_uid OR lower(s.email) = v_email)
     ORDER BY up.depth, (s.auth_user_id = v_uid) DESC NULLS LAST
     LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
    WITH RECURSIVE up(id, parent_business_id, depth) AS (
      SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
      UNION
      SELECT p.id, p.parent_business_id, up.depth + 1
        FROM public.businesses p JOIN up ON p.id = up.parent_business_id
       WHERE up.depth < 10
    )
    SELECT v_uid, NULL::uuid,
           COALESCE(NULLIF(trim(o.owner_name), ''), NULLIF(trim(o.owner), ''), 'Owner')
      FROM up JOIN public.businesses o ON o.id = up.id
     WHERE lower(o.email) = v_email
     ORDER BY up.depth
     LIMIT 1;
END $$;

-- ---------------------------------------------------------------------------
-- 5. How a sale's money at the till splits across methods
-- ---------------------------------------------------------------------------
-- p_split is the sale's payment_split. The app writes JSON.stringify(...) into
-- jsonb, so it is usually a JSON *string* holding an object; both forms are
-- read. Values may be numbers or numeric strings ('' means none).
-- Change is handed back in cash, so when the methods add up to more than was
-- received, non-cash methods are taken first and Cash absorbs the excess.
-- Everything is rounded to kobo first: some stored amounts carry 4 decimals,
-- and an unrounded 0.004 would become a 0.00 ledger row, fail amount > 0, and
-- abort the sale insert itself.
CREATE OR REPLACE FUNCTION public.pos_split_payments(p_split jsonb, p_method text, p_received numeric)
RETURNS TABLE (method text, amount numeric)
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_split jsonb := p_split;
  v_left numeric := round(COALESCE(p_received, 0), 2);
  v_m text;
  v_amt numeric;
  v_any boolean := false;
BEGIN
  IF v_left <= 0 THEN RETURN; END IF;
  IF jsonb_typeof(v_split) = 'string' THEN
    BEGIN v_split := (v_split #>> '{}')::jsonb; EXCEPTION WHEN others THEN v_split := NULL; END;
  END IF;

  IF jsonb_typeof(v_split) = 'object' THEN
    FOREACH v_m IN ARRAY ARRAY['Transfer', 'POS', 'Cash'] LOOP
      BEGIN v_amt := round(NULLIF(trim(v_split ->> v_m), '')::numeric, 2); EXCEPTION WHEN others THEN v_amt := NULL; END;
      IF v_amt IS NOT NULL AND v_amt > 0 AND v_left > 0 THEN
        method := v_m; amount := least(v_amt, v_left);
        v_left := v_left - amount; v_any := true;
        RETURN NEXT;
      END IF;
    END LOOP;
    -- Split amounts that fall short of what was received: the remainder has
    -- no recorded method.
    IF v_any AND v_left > 0 THEN
      method := 'Unspecified'; amount := v_left; RETURN NEXT;
    END IF;
    IF v_any THEN RETURN; END IF;
  END IF;

  method := CASE WHEN p_method IN ('Cash', 'Transfer', 'POS') THEN p_method ELSE 'Unspecified' END;
  amount := v_left;
  RETURN NEXT;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Stamp the actor on every new sale
-- ---------------------------------------------------------------------------
-- With no signed-in user (a trusted backend using the service role) the row
-- is left as sent. Otherwise the client's values are discarded.
CREATE OR REPLACE FUNCTION public.sales_stamp_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_actor record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  NEW.refunded_amount := 0;
  NEW.cashier_user_id := auth.uid();
  NEW.cashier_staff_id := NULL;
  NEW.shift_id := NULL;
  SELECT * INTO v_actor FROM public.pos_actor(NEW.business_id);
  IF FOUND THEN
    NEW.cashier_staff_id := v_actor.staff_id;
    NEW.staff_name := v_actor.staff_name;
    SELECT sh.id INTO NEW.shift_id
      FROM public.pos_shifts sh
     WHERE sh.business_id = NEW.business_id AND sh.opened_by = auth.uid() AND sh.closed_at IS NULL
     LIMIT 1;
  ELSE
    NEW.staff_name := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_stamp_actor ON public.sales;
CREATE TRIGGER sales_stamp_actor BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_stamp_actor();

-- ---------------------------------------------------------------------------
-- 7. Money taken at the till goes on the ledger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_record_payments_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF COALESCE(NEW.is_on_hold, false) OR (NEW.status IS NOT NULL AND NEW.status <> 'completed') THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_at,
                                    received_by, staff_id, staff_name, shift_id)
  SELECT NEW.business_id, NEW.id, 'sale', sp.method, sp.amount,
         COALESCE(NEW.created_at AT TIME ZONE 'UTC', now()),
         NEW.cashier_user_id, NEW.cashier_staff_id, NEW.staff_name, NEW.shift_id
    FROM public.pos_split_payments(NEW.payment_split, NEW.payment_method,
                                   least(COALESCE(NEW.amount_paid, 0), COALESCE(NEW.total, 0))) sp;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sales_record_payments ON public.sales;
CREATE TRIGGER sales_record_payments AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_record_payments_on_insert();

-- ---------------------------------------------------------------------------
-- 8. Shifts: open and close
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_pos_shift(p_business_id uuid, p_opening_float numeric DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_actor record;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_opening_float IS NULL OR p_opening_float < 0 THEN
    RAISE EXCEPTION 'Opening float must be zero or more' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actor FROM public.pos_actor(p_business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;
  BEGIN
    INSERT INTO public.pos_shifts (business_id, opened_by, staff_id, staff_name, opening_float)
    VALUES (p_business_id, v_actor.user_id, v_actor.staff_id, v_actor.staff_name, round(p_opening_float, 2))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have an open shift. Close it before opening another.' USING ERRCODE = '23505';
  END;
  RETURN v_id;
END $$;

-- The person who opened the shift closes it; the owner or a manager may close
-- a shift someone forgot to close. Expected cash is the server's figure.
CREATE OR REPLACE FUNCTION public.close_pos_shift(p_shift_id uuid, p_counted_cash numeric, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_shift public.pos_shifts%ROWTYPE;
  v_actor record;
  v_cash_in numeric;
  v_cash_out numeric;
  v_expected numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
    RAISE EXCEPTION 'Counted cash must be zero or more' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shift FROM public.pos_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Shift not found' USING ERRCODE = '42501';
  END IF;
  IF v_shift.closed_at IS NOT NULL THEN RAISE EXCEPTION 'This shift is already closed' USING ERRCODE = '22023'; END IF;
  IF v_shift.opened_by <> auth.uid() AND NOT public.is_business_manager(v_shift.business_id) THEN
    RAISE EXCEPTION 'Only the person who opened this shift, the owner or a manager can close it' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_actor FROM public.pos_actor(v_shift.business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(sum(amount) FILTER (WHERE kind IN ('sale', 'collection')), 0),
         COALESCE(sum(amount) FILTER (WHERE kind = 'refund'), 0)
    INTO v_cash_in, v_cash_out
    FROM public.sale_payments WHERE shift_id = v_shift.id AND method = 'Cash';
  v_expected := v_shift.opening_float + v_cash_in - v_cash_out;

  UPDATE public.pos_shifts
     SET closed_at = now(), closed_by = auth.uid(), closed_by_name = v_actor.staff_name,
         counted_cash = round(p_counted_cash, 2), expected_cash = v_expected,
         close_note = NULLIF(trim(p_note), '')
   WHERE id = v_shift.id;
  RETURN jsonb_build_object('shift_id', v_shift.id, 'expected_cash', v_expected,
    'counted_cash', round(p_counted_cash, 2), 'difference', round(p_counted_cash, 2) - v_expected);
END $$;

-- ---------------------------------------------------------------------------
-- 9. Credit collection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_sale_payment(p_sale_id uuid, p_amount numeric, p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_actor record;
  v_shift uuid;
  v_paid numeric;
  v_outstanding numeric;
  v_applied numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Payment method must be Cash, Transfer or POS' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be more than zero' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_sale.is_on_hold, false) OR (v_sale.status IS NOT NULL AND v_sale.status <> 'completed') THEN
    RAISE EXCEPTION 'Payments can only be recorded against a completed sale' USING ERRCODE = '22023';
  END IF;

  v_paid := least(COALESCE(v_sale.amount_paid, 0), COALESCE(v_sale.total, 0));
  v_outstanding := greatest(COALESCE(v_sale.total, 0) - v_paid, 0);
  IF v_outstanding <= 0 THEN RAISE EXCEPTION 'Nothing is outstanding on this sale' USING ERRCODE = '22023'; END IF;
  v_applied := least(round(p_amount, 2), v_outstanding);

  SELECT * INTO v_actor FROM public.pos_actor(v_sale.business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;
  SELECT sh.id INTO v_shift FROM public.pos_shifts sh
   WHERE sh.business_id = v_sale.business_id AND sh.opened_by = auth.uid() AND sh.closed_at IS NULL LIMIT 1;

  INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_by, staff_id, staff_name, shift_id)
  VALUES (v_sale.business_id, v_sale.id, 'collection', p_method, v_applied,
          auth.uid(), v_actor.staff_id, v_actor.staff_name, v_shift);

  UPDATE public.sales
     SET amount_paid = v_paid + v_applied,
         balance = v_outstanding - v_applied,
         is_credit = (v_outstanding - v_applied) > 0
   WHERE id = v_sale.id;

  -- The sale is the source of truth for its own debt. `status IS DISTINCT FROM`
  -- keeps a NULL-status debt in scope (`<> 'paid'` would drop it).
  UPDATE public.debts
     SET amount_paid = v_paid + v_applied,
         balance = v_outstanding - v_applied,
         status = CASE WHEN v_outstanding - v_applied <= 0 THEN 'paid' ELSE 'pending' END
   WHERE business_id = v_sale.business_id AND source = 'credit_sale' AND source_ref = v_sale.txn_no
     AND status IS DISTINCT FROM 'paid';

  RETURN jsonb_build_object('sale_id', v_sale.id, 'applied', v_applied,
    'amount_paid', v_paid + v_applied, 'balance', v_outstanding - v_applied);
END $$;

-- ---------------------------------------------------------------------------
-- 10. Refund (money only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_sale(p_sale_id uuid, p_amount numeric, p_method text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_actor record;
  v_shift uuid;
  v_refundable numeric;
  v_reason text := NULLIF(trim(p_reason), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Refund method must be Cash, Transfer or POS' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be more than zero' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'A refund needs a reason (3 to 300 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_business_manager(v_sale.business_id) THEN
    RAISE EXCEPTION 'Only the owner or a manager can record a refund' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_sale.is_on_hold, false) OR (v_sale.status IS NOT NULL AND v_sale.status <> 'completed') THEN
    RAISE EXCEPTION 'Only a completed sale can be refunded' USING ERRCODE = '22023';
  END IF;

  v_refundable := least(COALESCE(v_sale.amount_paid, 0), COALESCE(v_sale.total, 0)) - COALESCE(v_sale.refunded_amount, 0);
  IF round(p_amount, 2) > v_refundable THEN
    RAISE EXCEPTION 'Refund exceeds what was paid on this sale (at most %)', v_refundable USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor FROM public.pos_actor(v_sale.business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;
  SELECT sh.id INTO v_shift FROM public.pos_shifts sh
   WHERE sh.business_id = v_sale.business_id AND sh.opened_by = auth.uid() AND sh.closed_at IS NULL LIMIT 1;

  INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_by, staff_id, staff_name, shift_id, note)
  VALUES (v_sale.business_id, v_sale.id, 'refund', p_method, round(p_amount, 2),
          auth.uid(), v_actor.staff_id, v_actor.staff_name, v_shift, v_reason);

  UPDATE public.sales SET refunded_amount = COALESCE(refunded_amount, 0) + round(p_amount, 2) WHERE id = v_sale.id;

  RETURN jsonb_build_object('sale_id', v_sale.id, 'refunded', round(p_amount, 2),
    'refunded_total', COALESCE(v_sale.refunded_amount, 0) + round(p_amount, 2));
END $$;

-- ---------------------------------------------------------------------------
-- 11. Grants (re-verify proacl after apply: Supabase re-grants anon)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pos_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_split_payments(jsonb, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_stamp_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_record_payments_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_payments_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_pos_shift(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_pos_shift(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_sale_payment(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_sale(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_pos_shift(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_pos_shift(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_sale_payment(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_sale(uuid, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. Backfill the ledger from existing completed sales
-- ---------------------------------------------------------------------------
-- Historical collections were merged into amount_paid and cannot be separated:
-- they stay on the sale's own date. Rows are marked backfilled.
INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_at, staff_name, note, backfilled)
SELECT s.business_id, s.id, 'sale', sp.method, sp.amount,
       s.created_at AT TIME ZONE 'UTC', s.staff_name, 'Recorded before the payments ledger existed', true
  FROM public.sales s
 CROSS JOIN LATERAL public.pos_split_payments(s.payment_split, s.payment_method,
                                             least(COALESCE(s.amount_paid, 0), COALESCE(s.total, 0))) sp
 WHERE NOT COALESCE(s.is_on_hold, false)
   AND (s.status IS NULL OR s.status = 'completed')
   AND s.created_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.sale_payments p WHERE p.sale_id = s.id);

-- ---------------------------------------------------------------------------
-- 13. Export audit: the sales report Excel export
-- ---------------------------------------------------------------------------
-- Same signature as carehub_20261209 (so no sibling overload is created), the
-- allow-list gains sales_report.xlsx and includes_cost_data is now per type: the sales
-- report carries no cost figures.
CREATE OR REPLACE FUNCTION public.record_export_audit(
  p_business_id uuid,
  p_export_type text,
  p_row_count integer,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(auth.email());
  v_staff_id uuid;
  v_staff_role text;
  v_owner boolean;
  v_allowed boolean;
  v_perms jsonb;
  v_filters jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business id is required' USING ERRCODE = '22023';
  END IF;
  IF p_export_type IS NULL OR p_export_type NOT IN ('inventory.xlsx', 'sales_report.xlsx') THEN
    RAISE EXCEPTION 'Unknown export type' USING ERRCODE = '22023';
  END IF;
  IF p_row_count IS NULL OR p_row_count < 0 THEN
    RAISE EXCEPTION 'row count must be zero or more' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_filters) <> 'object' OR pg_column_size(v_filters) > 2000 THEN
    RAISE EXCEPTION 'filters must be a small JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT s.id, s.role INTO v_staff_id, v_staff_role
    FROM public.staff s
   WHERE s.business_id = p_business_id AND lower(s.email) = v_email AND s.status = 'active'
   LIMIT 1;

  WITH RECURSIVE up(id, parent_business_id, depth) AS (
    SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
    UNION
    SELECT p.id, p.parent_business_id, up.depth + 1
      FROM public.businesses p JOIN up ON p.id = up.parent_business_id
     WHERE up.depth < 10
  )
  SELECT EXISTS (
    SELECT 1 FROM up JOIN public.businesses o ON o.id = up.id WHERE lower(o.email) = v_email
  ) INTO v_owner;

  IF NOT v_owner AND v_staff_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501';
  END IF;

  IF v_owner OR v_staff_role = 'Owner' THEN
    v_allowed := true;
  ELSE
    SELECT r.permissions INTO v_perms
      FROM public.roles r
     WHERE r.business_id = p_business_id AND r.name = v_staff_role
     LIMIT 1;
    v_allowed := COALESCE(v_perms -> 'canExportReports' = 'true'::jsonb, false);
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Your role is not allowed to export data' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, branch_id, action, target_type, metadata)
  VALUES (
    v_uid,
    CASE WHEN v_owner THEN 'owner' ELSE 'staff' END,
    p_business_id,
    'export.created',
    split_part(p_export_type, '.', 1),
    jsonb_build_object(
      'export_type', p_export_type,
      'row_count', p_row_count,
      'filters', v_filters,
      'includes_cost_data', p_export_type = 'inventory.xlsx',
      'actor_email', v_email,
      'staff_id', v_staff_id,
      'staff_role', v_staff_role)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_export_audit(uuid, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_export_audit(uuid, text, integer, jsonb) TO authenticated;
