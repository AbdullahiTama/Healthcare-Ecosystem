-- Owner financial activity: who recorded each purchase, expense and debt, and
-- those records in the Owner's activity feed.
--
-- Docs: docs/architecture/Owner-Financial-Activity.md
-- Depends on: carehub_20261217_staff_activity.sql (staff_activity),
--   carehub_20261210_pos_accounting.sql (pos_actor), purchases, purchase_payments,
--   expenses, debts.
--
-- Status: PENDING, NOT APPLIED. Tested on PGlite
-- (scripts/db-tests/ownerFinancialActivity.pglite.mjs). Move to
-- supabase/migrations/ once applied.
--
-- 1. Who recorded it. `purchases` and `debts` recorded no person at all;
--    `expenses.staff_name` is free text typed on the form. Each table gains
--    recorded_by (auth user), recorded_by_staff_id and recorded_by_name,
--    stamped by a BEFORE INSERT trigger from the caller's session through
--    pos_actor() (staff row, else the Owner by business email). A value the
--    client sends is overwritten, and a BEFORE UPDATE trigger keeps the stamp,
--    so nobody can put a record in someone else's name. With no signed-in user
--    (service role, migrations) the row is left as sent. Rows created inside a
--    SECURITY DEFINER function still carry the caller's auth.uid(), so a debt
--    opened by a credit sale is stamped with the cashier. expenses.staff_name
--    is kept as written (it is what the form calls "staff").
--
-- 2. staff_activity() gains the money records the Owner asked to be told about:
--    purchase           a purchase recorded (supplier, items, what is unpaid)
--    supplier_payment   a payment to a supplier (purchase_payments kind 'payment';
--                       the at-purchase and pre-history rows are not new events)
--    credit_sale        a completed sale given on credit (was listed as 'sale')
--    debt               a debt entered by hand (debts opened by a credit sale or
--                       a purchase are already listed as those)
--    expense            now attributed from the stamp when there is one, with
--                       its id in `ref` so the app can open it
--    `ref` carries what the app needs to open the record: the sale's txn_no, or
--    the purchase / expense / debt id. Same signature and return type; still
--    Owner only, read only, bounded.
--
-- Rollback: re-run carehub_20261217_staff_activity.sql (restores the function);
--   DROP TRIGGER stamp_recorded_by_ins / stamp_recorded_by_upd ON each table;
--   DROP FUNCTION public.stamp_recorded_by(), public.keep_recorded_by();
--   the added columns are nullable and may stay.

-- ── 1. Who recorded it ───────────────────────────────────────────────────────

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS recorded_by uuid,
  ADD COLUMN IF NOT EXISTS recorded_by_staff_id uuid, ADD COLUMN IF NOT EXISTS recorded_by_name text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recorded_by uuid,
  ADD COLUMN IF NOT EXISTS recorded_by_staff_id uuid, ADD COLUMN IF NOT EXISTS recorded_by_name text;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS recorded_by uuid,
  ADD COLUMN IF NOT EXISTS recorded_by_staff_id uuid, ADD COLUMN IF NOT EXISTS recorded_by_name text;

CREATE OR REPLACE FUNCTION public.stamp_recorded_by()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_actor record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  NEW.recorded_by := auth.uid();
  NEW.recorded_by_staff_id := NULL;
  NEW.recorded_by_name := NULL;
  SELECT a.staff_id, a.staff_name INTO v_actor FROM public.pos_actor(NEW.business_id) a LIMIT 1;
  IF FOUND THEN
    NEW.recorded_by_staff_id := v_actor.staff_id;
    NEW.recorded_by_name := v_actor.staff_name;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.keep_recorded_by()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  NEW.recorded_by := OLD.recorded_by;
  NEW.recorded_by_staff_id := OLD.recorded_by_staff_id;
  NEW.recorded_by_name := OLD.recorded_by_name;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.stamp_recorded_by() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.keep_recorded_by() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchases', 'expenses', 'debts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS stamp_recorded_by_ins ON public.%I', t);
    EXECUTE format('CREATE TRIGGER stamp_recorded_by_ins BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_recorded_by()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS stamp_recorded_by_upd ON public.%I', t);
    EXECUTE format('CREATE TRIGGER stamp_recorded_by_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.keep_recorded_by()', t);
  END LOOP;
END $$;

-- ── 2. The Owner's feed ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.staff_activity(
  p_business_id uuid, p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 1000)
RETURNS TABLE (
  occurred_at timestamptz, kind text, staff_id uuid, actor_name text, actor_role text,
  summary text, amount numeric, ref text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_limit integer := least(greatest(COALESCE(p_limit, 1000), 1), 2000);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_business_id IS NULL OR NOT public.is_business_owner(p_business_id) THEN
    RAISE EXCEPTION 'Only the Owner can view staff activity' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'Choose a period of up to 366 days' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH ev (at, kind, sid, uid, rec_name, summary, amount, ref) AS (
    -- Sales, credit sales and held sales
    SELECT (s.created_at AT TIME ZONE 'UTC'),
           CASE WHEN COALESCE(s.is_on_hold, false) THEN 'held'
                WHEN COALESCE(s.is_credit, false) OR s.payment_method = 'Credit' THEN 'credit_sale'
                ELSE 'sale' END,
           s.cashier_staff_id, s.cashier_user_id, s.staff_name,
           s.txn_no || ' · ' || COALESCE(NULLIF(s.client_name, ''), 'Walk-in') || ' · ' || COALESCE(s.payment_method, '')
             || CASE WHEN NOT COALESCE(s.is_on_hold, false) AND COALESCE(s.balance, 0) > 0
                     THEN ' · ₦' || to_char(s.balance, CASE WHEN s.balance = trunc(s.balance) THEN 'FM999,999,999,990' ELSE 'FM999,999,999,990.00' END) || ' still owed' ELSE '' END,
           s.total, s.txn_no
      FROM public.sales s
     WHERE s.business_id = p_business_id
       AND (s.created_at AT TIME ZONE 'UTC') >= p_from AND (s.created_at AT TIME ZONE 'UTC') < p_to
       AND (COALESCE(s.is_on_hold, false) OR s.status IS NULL OR s.status = 'completed')
    UNION ALL
    -- Refunds and repayments
    SELECT sp.received_at, CASE sp.kind WHEN 'refund' THEN 'refund' ELSE 'repayment' END,
           sp.staff_id, sp.received_by, sp.staff_name,
           COALESCE(sa.txn_no, 'Sale') || ' · ' || sp.method || COALESCE(' · ' || NULLIF(sp.note, ''), ''),
           sp.amount, sa.txn_no
      FROM public.sale_payments sp LEFT JOIN public.sales sa ON sa.id = sp.sale_id
     WHERE sp.business_id = p_business_id AND sp.kind IN ('refund', 'collection')
       AND sp.received_at >= p_from AND sp.received_at < p_to
    UNION ALL
    -- Owner corrections
    SELECT al.created_at, CASE al.action WHEN 'sale.edited' THEN 'sale_edited' ELSE 'sale_deleted' END,
           NULL::uuid, al.actor_id, NULL::text,
           COALESCE(al.metadata ->> 'txn_no', 'Sale') || ' · ' || COALESCE(al.metadata ->> 'reason', ''),
           COALESCE((al.metadata -> 'after' ->> 'total')::numeric, (al.metadata -> 'before' ->> 'total')::numeric),
           al.metadata ->> 'txn_no'
      FROM public.audit_log al
     WHERE al.branch_id = p_business_id AND al.target_type = 'sale' AND al.action IN ('sale.edited', 'sale.deleted')
       AND al.created_at >= p_from AND al.created_at < p_to
    UNION ALL
    -- Expenses: the stamp when there is one, else the typed name
    SELECT (x.created_at AT TIME ZONE 'UTC'), 'expense', x.recorded_by_staff_id, x.recorded_by,
           COALESCE(NULLIF(x.recorded_by_name, ''), x.staff_name),
           COALESCE(x.category, 'Expense') || COALESCE(' · ' || NULLIF(x.description, ''), ''), x.amount, x.id::text
      FROM public.expenses x
     WHERE x.business_id = p_business_id
       AND (x.created_at AT TIME ZONE 'UTC') >= p_from AND (x.created_at AT TIME ZONE 'UTC') < p_to
    UNION ALL
    -- Purchases
    SELECT (pu.created_at AT TIME ZONE 'UTC'), 'purchase', pu.recorded_by_staff_id, pu.recorded_by, pu.recorded_by_name,
           COALESCE(NULLIF(pu.supplier_name, ''), 'Supplier') || ' · '
             || CASE WHEN jsonb_typeof(pu.items) = 'array' AND jsonb_array_length(pu.items) > 1
                     THEN jsonb_array_length(pu.items)::text || ' items'
                     ELSE COALESCE(NULLIF(pu.product_name, ''), 'Purchase') END
             || CASE WHEN COALESCE(pu.balance, 0) > 0
                     THEN ' · ₦' || to_char(pu.balance, CASE WHEN pu.balance = trunc(pu.balance) THEN 'FM999,999,999,990' ELSE 'FM999,999,999,990.00' END) || ' unpaid'
                          || COALESCE(' · due ' || NULLIF(pu.due_date, ''), '')
                     ELSE ' · paid' END,
           pu.total_cost, pu.id::text
      FROM public.purchases pu
     WHERE pu.business_id = p_business_id
       AND (pu.created_at AT TIME ZONE 'UTC') >= p_from AND (pu.created_at AT TIME ZONE 'UTC') < p_to
    UNION ALL
    -- Payments to suppliers (not the at-purchase or pre-history rows)
    SELECT pp.created_at, 'supplier_payment', NULL::uuid, pp.recorded_by, pp.staff_name,
           COALESCE(NULLIF(pp.supplier_name, ''), 'Supplier') || ' · ' || COALESCE(pp.method, '')
             || CASE WHEN COALESCE(pp.balance_after, 0) > 0
                     THEN ' · ₦' || to_char(pp.balance_after, CASE WHEN pp.balance_after = trunc(pp.balance_after) THEN 'FM999,999,999,990' ELSE 'FM999,999,999,990.00' END) || ' still owed' ELSE ' · settled' END
             || COALESCE(' · ' || NULLIF(pp.note, ''), ''),
           pp.amount, pp.purchase_id::text
      FROM public.purchase_payments pp
     WHERE pp.business_id = p_business_id AND pp.kind = 'payment'
       AND pp.created_at >= p_from AND pp.created_at < p_to
    UNION ALL
    -- Debts entered by hand
    SELECT (d.created_at AT TIME ZONE 'UTC'), 'debt', d.recorded_by_staff_id, d.recorded_by, d.recorded_by_name,
           CASE WHEN d.direction = 'owes_us' THEN 'Owed to us' ELSE 'We owe' END || ' · '
             || COALESCE(NULLIF(d.party_name, ''), 'Unnamed') || COALESCE(' · ' || NULLIF(d.description, ''), '')
             || COALESCE(' · due ' || NULLIF(d.due_date, ''), ''),
           d.amount, d.id::text
      FROM public.debts d
     WHERE d.business_id = p_business_id AND COALESCE(d.source, 'manual') NOT IN ('credit_sale', 'purchase')
       AND (d.created_at AT TIME ZONE 'UTC') >= p_from AND (d.created_at AT TIME ZONE 'UTC') < p_to
    UNION ALL
    -- Stock changes with a known actor
    SELECT sm.created_at, 'stock', NULL::uuid,
           COALESCE(sm.actor_id, CASE WHEN sm.moved_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN sm.moved_by::uuid END),
           CASE WHEN sm.moved_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN NULLIF(sm.moved_by, '') END,
           sm.movement_type || ' · ' || sm.quantity::text || COALESCE(' · ' || NULLIF(sm.reason, ''), ''), NULL::numeric, NULL::text
      FROM public.stock_movements sm
     WHERE sm.business_id = p_business_id AND sm.movement_type <> 'sale'
       AND (sm.actor_id IS NOT NULL OR COALESCE(sm.moved_by, '') <> '')
       AND sm.created_at >= p_from AND sm.created_at < p_to
    UNION ALL
    -- Attendance
    SELECT c.created_at, 'checkin', c.staff_id, c.user_id, c.staff_name,
           c.event_type || ' · ' || c.status || COALESCE(' · ' || NULLIF(c.location_label, ''), ''), NULL::numeric, NULL::text
      FROM public.staff_checkins c
     WHERE c.business_id = p_business_id AND c.created_at >= p_from AND c.created_at < p_to
    UNION ALL
    -- Field visits
    SELECT f.created_at, 'field_visit', f.staff_id, NULL::uuid, f.rep_name,
           COALESCE(NULLIF(f.facility_name, ''), NULLIF(f.place_of_visit, ''), NULLIF(f.location_label, ''), 'Visit'), NULL::numeric, NULL::text
      FROM public.field_activities f
     WHERE f.business_id = p_business_id AND f.created_at >= p_from AND f.created_at < p_to
    UNION ALL
    -- Shifts
    SELECT sh.opened_at, 'shift_open', sh.staff_id, sh.opened_by, sh.staff_name, 'Opening float', sh.opening_float, NULL::text
      FROM public.pos_shifts sh
     WHERE sh.business_id = p_business_id AND sh.opened_at >= p_from AND sh.opened_at < p_to
    UNION ALL
    SELECT sh.closed_at, 'shift_close', sh.staff_id, sh.closed_by, COALESCE(sh.closed_by_name, sh.staff_name),
           'Counted ' || sh.counted_cash::text || ' of expected ' || COALESCE(sh.expected_cash, 0)::text,
           sh.counted_cash - COALESCE(sh.expected_cash, 0), NULL::text
      FROM public.pos_shifts sh
     WHERE sh.business_id = p_business_id AND sh.closed_at IS NOT NULL AND sh.closed_at >= p_from AND sh.closed_at < p_to
  )
  SELECT ev.at, ev.kind, who.id,
         COALESCE(who.full_name, NULLIF(ev.rec_name, ''), 'Owner or unlinked'),
         who.role, ev.summary, ev.amount, ev.ref
    FROM ev
    LEFT JOIN LATERAL (
      SELECT st.id, st.full_name, st.role
        FROM public.staff st
       WHERE st.business_id = p_business_id
         AND (st.id = ev.sid
              OR (ev.sid IS NULL AND ev.uid IS NOT NULL AND st.auth_user_id = ev.uid)
              OR (ev.sid IS NULL AND ev.uid IS NULL AND ev.rec_name IS NOT NULL AND lower(st.full_name) = lower(ev.rec_name)))
       ORDER BY (st.id = ev.sid) DESC NULLS LAST
       LIMIT 1
    ) who ON true
   ORDER BY ev.at DESC
   LIMIT v_limit;
END $$;

REVOKE ALL ON FUNCTION public.staff_activity(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_activity(uuid, timestamptz, timestamptz, integer) TO authenticated;
