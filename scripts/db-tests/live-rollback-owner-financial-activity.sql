-- ROLLED-BACK production probe for carehub_20261229_owner_financial_activity.sql.
-- Run BEFORE applying (via the MCP execute_sql tool or the SQL editor). It creates its own fixtures
-- (rollback.invalid emails), applies the migration, checks it as real roles, then ends in a deliberate
-- RAISE EXCEPTION so EVERYTHING (DDL and fixtures) rolls back. The error message IS the report.
DO $live$
DECLARE
  A uuid; B uuid; cashA uuid; mgrA uuid; cashB uuid; p1 uuid; e1 uuid; d1 uuid;
  u_cashA uuid := gen_random_uuid(); u_mgrA uuid := gen_random_uuid(); u_cashB uuid := gen_random_uuid(); u_ownA uuid := gen_random_uuid();
  e_cashA text := 'rb-casha@rollback.invalid'; e_mgrA text := 'rb-mgra@rollback.invalid'; e_cashB text := 'rb-cashb@rollback.invalid';
  e_ownA text := 'rb-owna@rollback.invalid'; e_ownB text := 'rb-ownb@rollback.invalid';
  forged uuid := gen_random_uuid();
  r text; rep text := '';
  n_purchases bigint; n_expenses bigint; n_debts bigint;
BEGIN
  SELECT count(*) INTO n_purchases FROM public.purchases;
  SELECT count(*) INTO n_expenses FROM public.expenses;
  SELECT count(*) INTO n_debts FROM public.debts;

  EXECUTE $h$
    CREATE FUNCTION pg_temp.run_as(p_uid uuid, p_email text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
    DECLARE r text;
    BEGIN
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p_uid, 'email', p_email)::text, true);
        SET LOCAL ROLE authenticated;
        EXECUTE p_sql INTO r;
        RESET ROLE;
        RETURN coalesce(r, '(null)');
      EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        RETURN 'ERR:' || sqlstate || ' ' || sqlerrm;
      END;
    END $f$;
  $h$;
  EXECUTE $h$
    CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_got text) RETURNS text LANGUAGE sql AS $f$
      SELECT CASE WHEN p_ok THEN 'PASS ' || p_name ELSE 'FAIL ' || p_name || '  (got ' || coalesce(p_got, 'null') || ')' END || E'\n'
    $f$;
  $h$;

  -- The migration, exactly as in the file.
  EXECUTE $mig$
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

$mig$;

  -- Fixtures
  INSERT INTO public.businesses (name, owner, owner_name, email) VALUES ('RB Pharmacy A', 'RB Owner', 'RB Owner A', e_ownA) RETURNING id INTO A;
  INSERT INTO public.businesses (name, owner, email) VALUES ('RB Pharmacy B', 'RB Owner B', e_ownB) RETURNING id INTO B;
  INSERT INTO public.staff (business_id, full_name, email, role, status, auth_user_id) VALUES (A, 'RB Cashier', e_cashA, 'Cashier', 'active', u_cashA) RETURNING id INTO cashA;
  INSERT INTO public.staff (business_id, full_name, email, role, status) VALUES (A, 'RB Manager', e_mgrA, 'General Manager', 'active') RETURNING id INTO mgrA;
  INSERT INTO public.staff (business_id, full_name, email, role, status) VALUES (B, 'RB Cashier B', e_cashB, 'Cashier', 'active') RETURNING id INTO cashB;

  -- 1. A cashier's purchase is stamped with the cashier, whatever the screen sends
  r := pg_temp.run_as(u_cashA, e_cashA, format($q$insert into public.purchases (business_id,supplier_name,product_name,total_cost,amount_paid,balance,due_date,status,recorded_by,recorded_by_name)
        values (%L,'RB Supplier','RB Drug',50000,20000,30000,'2026-11-15','partial',%L,'Somebody Else') returning id::text$q$, A, forged));
  rep := rep || pg_temp.chk('cashier can record a purchase', r !~ '^ERR', r);
  IF r !~ '^ERR' THEN p1 := r::uuid; END IF;
  SELECT recorded_by::text || '|' || coalesce(recorded_by_staff_id::text, '') || '|' || coalesce(recorded_by_name, '') INTO r FROM public.purchases WHERE id = p1;
  rep := rep || pg_temp.chk('purchase stamped with the cashier, forged values ignored', r = u_cashA::text || '|' || cashA::text || '|RB Cashier', r);

  -- 2. The stamp survives an update that tries to change it
  r := pg_temp.run_as(u_mgrA, e_mgrA, format($q$update public.purchases set recorded_by = %L, recorded_by_name = 'Rewritten', notes = 'checked' where id = %L returning notes$q$, forged, p1));
  SELECT recorded_by::text || '|' || coalesce(recorded_by_name, '') || '|' || coalesce(notes, '') INTO r FROM public.purchases WHERE id = p1;
  rep := rep || pg_temp.chk('stamp kept on update, the update itself applies', r = u_cashA::text || '|RB Cashier|checked', r);

  -- 3. Expense by a staff member linked by email only; typed name kept
  r := pg_temp.run_as(u_mgrA, e_mgrA, format($q$insert into public.expenses (id,business_id,category,description,amount,date,staff_name) values (gen_random_uuid(),%L,'Transport','RB fuel',2500,'2026-10-31','Typed On Form') returning id::text$q$, A));
  rep := rep || pg_temp.chk('staff can record an expense', r !~ '^ERR', r);
  IF r !~ '^ERR' THEN e1 := r::uuid; END IF;
  SELECT coalesce(recorded_by_staff_id::text, '') || '|' || coalesce(recorded_by_name, '') || '|' || coalesce(staff_name, '') INTO r FROM public.expenses WHERE id = e1;
  rep := rep || pg_temp.chk('expense stamped with the manager, typed name kept', r = mgrA::text || '|RB Manager|Typed On Form', r);

  -- 4. The Owner's debt is stamped by name
  r := pg_temp.run_as(u_ownA, e_ownA, format($q$insert into public.debts (business_id,direction,party_name,amount,amount_paid,balance,due_date,status,description,source) values (%L,'we_owe','RB Landlord',120000,0,120000,'2026-11-01','pending','Rent','manual') returning id::text$q$, A));
  rep := rep || pg_temp.chk('owner can record a debt', r !~ '^ERR', r);
  IF r !~ '^ERR' THEN d1 := r::uuid; END IF;
  SELECT coalesce(recorded_by::text, '') || '|' || coalesce(recorded_by_staff_id::text, 'none') || '|' || coalesce(recorded_by_name, '') INTO r FROM public.debts WHERE id = d1;
  rep := rep || pg_temp.chk('owner debt stamped with owner login and name', r = u_ownA::text || '|none|RB Owner A', r);

  -- 5. Another business cannot record into this one
  r := pg_temp.run_as(u_cashB, e_cashB, format($q$insert into public.purchases (business_id,supplier_name,total_cost) values (%L,'X',1) returning id::text$q$, A));
  rep := rep || pg_temp.chk('another business is refused', r ~ '^ERR', r);

  -- 6. The Owner's feed
  r := pg_temp.run_as(u_ownA, e_ownA, format($q$select string_agg(kind || '|' || actor_name || '|' || coalesce(ref,'') || '|' || summary, ' ;; ' order by kind) from public.staff_activity(%L, now() - interval '1 day', now() + interval '1 day', 100)$q$, A));
  rep := rep || pg_temp.chk('feed: purchase with who, unpaid and due', r LIKE '%purchase|RB Cashier|' || p1::text || '|RB Supplier · RB Drug · ₦30,000 unpaid · due 2026-11-15%', r);
  rep := rep || pg_temp.chk('feed: expense with id and stamped person', r LIKE '%expense|RB Manager|' || e1::text || '|Transport · RB fuel%', r);
  rep := rep || pg_temp.chk('feed: hand-entered debt by the owner', r LIKE '%debt|RB Owner A|' || d1::text || '|We owe · RB Landlord · Rent · due 2026-11-01%', r);
  r := pg_temp.run_as(u_mgrA, e_mgrA, format($q$select count(*)::text from public.staff_activity(%L, now() - interval '1 day', now(), 10)$q$, A));
  rep := rep || pg_temp.chk('feed refused to a manager', r LIKE 'ERR:42501%', r);
  r := pg_temp.run_as(u_cashA, e_cashA, format($q$select count(*)::text from public.staff_activity(%L, now() - interval '1 day', now(), 10)$q$, A));
  rep := rep || pg_temp.chk('feed refused to a cashier', r LIKE 'ERR:42501%', r);

  -- 7. Privileges and untouched data
  rep := rep || pg_temp.chk('stamp_recorded_by not executable by authenticated', NOT has_function_privilege('authenticated', 'public.stamp_recorded_by()', 'execute'), '');
  rep := rep || pg_temp.chk('keep_recorded_by not executable by anon', NOT has_function_privilege('anon', 'public.keep_recorded_by()', 'execute'), '');
  rep := rep || pg_temp.chk('staff_activity not executable by anon', NOT has_function_privilege('anon', 'public.staff_activity(uuid,timestamptz,timestamptz,integer)', 'execute'), '');
  rep := rep || pg_temp.chk('existing rows untouched (counts = before + fixtures)',
    (SELECT count(*) FROM public.purchases) = n_purchases + 1 AND (SELECT count(*) FROM public.expenses) = n_expenses + 1 AND (SELECT count(*) FROM public.debts) = n_debts + 1, '');
  rep := rep || pg_temp.chk('existing rows carry no stamp', NOT EXISTS (SELECT 1 FROM public.purchases WHERE recorded_by IS NOT NULL AND id <> p1), '');

  RAISE EXCEPTION E'ROLLBACK REPORT\n%', rep;
END $live$;
