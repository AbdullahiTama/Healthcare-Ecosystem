-- carehub_20270108_staff_activity_expense_status
--
-- Status: APPLIED TO PRODUCTION 2026-11-09 with the owner's approval (Supabase migration version 20261109110447),
-- applied verbatim from this file (statements only). Tested first on PGlite
-- (apps/carefind/src/test/expenses/staffActivityExpenseStatus.db.test.js).
-- The function body is carehub_20261229_owner_financial_activity's staff_activity(), confirmed identical to the live
-- definition on 2026-11-09 immediately before applying (md5 of the whitespace-normalised source:
-- 51a4846a778d58dc1180b4d2541d687d; no dependent objects), with only the changes below.
-- After: result ends in still_owed numeric; SECURITY DEFINER; search_path public, pg_temp; EXECUTE: authenticated only.
-- Live probe (DO block that raised at the end; 0 probe rows remained), with the carehub.test Owner and cashier:
--   cashier calls staff_activity():                refused "Only the Owner can view staff activity"
--   Owner, unpaid 3,000 bill with 1,000 paid:       expense row "Utilities · PROBE water · ₦2,000 still to pay",
--                                                   still_owed 2000.00; expense_payment row
--                                                   "Utilities · PROBE water · Transfer · ₦2,000 still to pay · probe"
--   rows other than expenses with still_owed:       0
--   anon calls staff_activity():                   refused, permission denied for function
--
-- PROBLEM
-- -------
-- Expenses now have a payment status (carehub_20270107_expense_payments), but the Owner's Staff > Activity screen
-- showed each expense a staff member logged with its amount only: not whether it was paid, nor what is still owed,
-- nor who later paid a bill.
--
-- FIX (staff_activity() only; nothing else changes)
-- ---
--   1. An expense row's summary ends "· paid" or "· ₦X still to pay" (its status now), as purchase rows already say
--      "· paid" or "· ₦X unpaid".
--   2. A new result column, still_owed: what is still to pay on that expense now (NULL for every other kind), so the
--      screen can show the status and total it per person without parsing text.
--   3. A new kind, expense_payment: each payment recorded later on an expense (Record payment), with who recorded it,
--      the method and what was left after it, like supplier_payment. The amount paid when an expense is logged and the
--      "before payment history" rows are not repeated (the expense row already covers them).
-- Adding a result column changes the function's return type, so it is dropped and re-created in one transaction;
-- the grants are restored exactly (EXECUTE: authenticated; PUBLIC and anon revoked). Older app builds read the rows
-- by name and simply ignore the extra column.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No access is widened. The Owner check is unchanged and still first (is_business_owner); the new rows and the
--     new column are scoped to p_business_id like every other branch.
--   * SECURITY DEFINER and search_path public, pg_temp are unchanged.
--
-- ROLLBACK: re-run the staff_activity() section of carehub_20261229_owner_financial_activity.sql after
--   DROP FUNCTION public.staff_activity(uuid, timestamptz, timestamptz, integer);
--   then restore its REVOKE/GRANT (both are in that file).

DROP FUNCTION IF EXISTS public.staff_activity(uuid, timestamptz, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.staff_activity(
  p_business_id uuid, p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 1000)
RETURNS TABLE (
  occurred_at timestamptz, kind text, staff_id uuid, actor_name text, actor_role text,
  summary text, amount numeric, ref text, still_owed numeric)
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
           COALESCE(x.category, 'Expense') || COALESCE(' · ' || NULLIF(x.description, ''), '')
             -- Payment status now (carehub_20270107_expense_payments): paid, or what is still to pay.
             || CASE WHEN COALESCE(x.amount, 0) - COALESCE(x.amount_paid, x.amount, 0) > 0
                     THEN ' · ' || '₦' || to_char((COALESCE(x.amount, 0) - x.amount_paid), CASE WHEN (COALESCE(x.amount, 0) - x.amount_paid) = trunc((COALESCE(x.amount, 0) - x.amount_paid)) THEN 'FM999,999,999,990' ELSE 'FM999,999,999,990.00' END) || ' still to pay'
                     ELSE ' · paid' END,
           x.amount, x.id::text
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
    -- Payments on expenses recorded later (not the amount paid when the expense was logged, nor pre-history rows)
    SELECT ep.created_at, 'expense_payment', NULL::uuid, ep.recorded_by, ep.staff_name,
           COALESCE(x.category, 'Expense') || COALESCE(' · ' || NULLIF(x.description, ''), '') || ' · ' || ep.method
             || CASE WHEN ep.balance_after > 0
                     THEN ' · ' || '₦' || to_char(ep.balance_after, CASE WHEN ep.balance_after = trunc(ep.balance_after) THEN 'FM999,999,999,990' ELSE 'FM999,999,999,990.00' END) || ' still to pay' ELSE ' · now paid' END
             || COALESCE(' · ' || NULLIF(ep.note, ''), ''),
           ep.amount, ep.expense_id::text
      FROM public.expense_payments ep LEFT JOIN public.expenses x ON x.id = ep.expense_id
     WHERE ep.business_id = p_business_id AND ep.kind = 'payment'
       AND ep.created_at >= p_from AND ep.created_at < p_to
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
         who.role, ev.summary, ev.amount, ev.ref,
         -- What is still to pay on an expense now (NULL for every other kind of activity).
         CASE WHEN ev.kind = 'expense' THEN (
           SELECT greatest(COALESCE(x2.amount, 0) - COALESCE(x2.amount_paid, x2.amount, 0), 0)
             FROM public.expenses x2 WHERE x2.id = ev.ref::uuid AND x2.business_id = p_business_id) END
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
