-- Staff activity: one owner-only, read-only feed of what each staff member did.
--
-- Docs: docs/architecture/Staff-Activity.md
-- Depends on: carehub_20261216_sales_owner_corrections.sql (is_business_owner),
--   carehub_20261210_pos_accounting.sql (sale_payments, pos_shifts, sales.cashier_*),
--   carehub_20260810_audit_log.sql, staff_checkins, field_activities, expenses,
--   stock_movements.
--
-- Why a function: every table below is readable by any member of the business
-- (their policies are business-scoped), so hiding the tab in the app would be a
-- screen rule only. staff_activity() is SECURITY DEFINER and refuses everyone but
-- the Owner (is_business_owner), so the combined feed -- who did what, when --
-- is the Owner's in the database too. It reads; it changes nothing.
--
-- What it reports (each row = one thing a person did):
--   sale / held        sales rung up or parked (deleted sales are not sales; the
--                      deletion appears as sale_deleted)
--   refund / repayment payments ledger rows of those kinds
--   sale_edited / sale_deleted   Owner corrections from audit_log
--   expense            expenses, matched to staff by recorded name
--   stock              stock movements with a known actor (automatic 'sale'
--                      movements are left out; the sale itself is listed)
--   checkin            attendance check-ins / outs
--   field_visit        field activity reports
--   shift_open / shift_close   till shifts (close carries counted - expected)
--
-- Who is "the person": staff_id when the source records it (sales, payments,
-- check-ins, field visits, shifts), the auth user mapped through
-- staff.auth_user_id (audit log, stock), else the free-text name (expenses).
-- A row with no staff match (typically the Owner, who has no staff row) comes
-- back with a NULL staff_id and its recorded name.
--
-- Bounds: at most 366 days per call and 2000 rows (newest first); the caller is
-- told nothing is hidden silently because the app shows a notice when the cap is
-- reached.
--
-- Rollback: DROP FUNCTION IF EXISTS public.staff_activity(uuid, timestamptz, timestamptz, integer);

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
    -- Sales and held sales
    SELECT (s.created_at AT TIME ZONE 'UTC'),
           CASE WHEN COALESCE(s.is_on_hold, false) THEN 'held' ELSE 'sale' END,
           s.cashier_staff_id, s.cashier_user_id, s.staff_name,
           s.txn_no || ' · ' || COALESCE(NULLIF(s.client_name, ''), 'Walk-in') || ' · ' || COALESCE(s.payment_method, ''),
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
    -- Owner corrections (refunds are already listed from the ledger above)
    SELECT al.created_at, CASE al.action WHEN 'sale.edited' THEN 'sale_edited' ELSE 'sale_deleted' END,
           NULL::uuid, al.actor_id, NULL::text,
           COALESCE(al.metadata ->> 'txn_no', 'Sale') || ' · ' || COALESCE(al.metadata ->> 'reason', ''),
           COALESCE((al.metadata -> 'after' ->> 'total')::numeric, (al.metadata -> 'before' ->> 'total')::numeric),
           al.metadata ->> 'txn_no'
      FROM public.audit_log al
     WHERE al.branch_id = p_business_id AND al.target_type = 'sale' AND al.action IN ('sale.edited', 'sale.deleted')
       AND al.created_at >= p_from AND al.created_at < p_to
    UNION ALL
    -- Expenses (recorded by name only)
    SELECT (x.created_at AT TIME ZONE 'UTC'), 'expense', NULL::uuid, NULL::uuid, x.staff_name,
           COALESCE(x.category, 'Expense') || COALESCE(' · ' || NULLIF(x.description, ''), ''), x.amount, NULL::text
      FROM public.expenses x
     WHERE x.business_id = p_business_id
       AND (x.created_at AT TIME ZONE 'UTC') >= p_from AND (x.created_at AT TIME ZONE 'UTC') < p_to
    UNION ALL
    -- Stock movements with a known actor; moved_by is text (an id or a name)
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
    SELECT c.created_at, 'checkin', c.staff_id, c.user_id, NULL::text,
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
    -- Till shifts
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
    -- The person: the staff row named by id, else by auth user, else by recorded name.
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
