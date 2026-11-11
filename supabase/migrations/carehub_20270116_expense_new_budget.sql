-- carehub_20270116_expense_new_budget
--
-- Status: APPLIED TO PRODUCTION 2026-11-11 with the owner's approval (Supabase migration version 20261111153408),
-- applied verbatim from this file. set_expense_budget was re-read just before and was unchanged.
-- After applying: RLS on expense_budget_history; authenticated SELECT only on it and on expense_budgets, anon nothing;
-- both functions SECURITY DEFINER, search_path public, pg_temp, EXECUTE for authenticated and service_role only. The
-- two existing budgets were unchanged (starts_on NULL, no history rows).
-- Rolled-back live probe (a DO block that raised; budgets and history identical before and after), on the business
-- that reported the budget problem (2026-11 budget 50,000; 50,700 spent 1-10 Nov, 0 after), as its Owner, a cashier
-- on a role with export rights, its General Manager, and the owner of another business:
--   1-4 amount 0 / start in December / start on 1 Nov / August with no budget:  each REFUSED with its sentence
--   5   Owner starts 30,000 from 11 Nov:            ALLOWED (2026-11, 30000, starts_on 2026-11-11)
--   6   history:                                    50,000 from 1 Nov to 10 Nov, spent 50,700, replaced by 30,000
--   7   a second new budget on the same day:        REFUSED "must start after the current one (from 2026-11-11)"
--   8-9 Edit to 35,000:                             start kept (2026-11-11); history 'edited' 30,000 -> 35,000
--   10  Edit to the same amount:                    no history row added
--   11-14 Owner INSERT/UPDATE/DELETE history, UPDATE starts_on directly:  REFUSED, permission denied
--   15  cashier reads:                              2 history rows; budget 35,000 from 2026-11-11
--   16-18 cashier / manager set a new budget, manager edits:  REFUSED 42501
--   19-20 another business reads / sets:            0 rows / REFUSED 42501
--   21-22 anon reads / sets:                        REFUSED, permission denied
-- Security advisor afterwards: the day's baseline (8 groups, 241 findings) plus exactly one finding,
-- authenticated_security_definer_function_executable for start_new_expense_budget, which is intended (the app's way to
-- set a new budget; it refuses everyone but the Owner).
-- Tested on PGlite: apps/carefind/src/test/expenses/expenseNewBudget.db.test.js, with the live
-- current_business_ids(), is_business_owner(), is_platform_admin() and expense_effective_date(), and
-- set_expense_budget() read verbatim from the live database on 2026-11-11 (it matched carehub_20270103).
-- Docs: docs/architecture/Expense-Budgets.md ("Set new budget").
--
-- PROBLEM
-- -------
-- "Users cannot set a new budget after the existing budget is exhausted. Only the Edit option is available."
-- A business has one budget per month (expense_budgets, carehub_20270103), and the only write is
-- set_expense_budget(), which overwrites that month's amount. Once a ₦50,000 budget is used up mid-month the Owner
-- can only raise the same figure, which (a) rewrites history (the month now reads as if it always had the bigger
-- budget, and the overspend disappears) and (b) keeps counting the spending that exhausted the old budget against
-- the new one, so a fresh ₦30,000 on the 18th shows as already over.
--
-- FIX
-- ---
--   1. expense_budgets.starts_on (date, NULL = the 1st of the month): the day a month's budget began. Spending
--      against a budget is counted from starts_on to the end of its month. A budget carried into a later month
--      counts that month from the 1st, as before.
--   2. expense_budget_history: every budget that was replaced or edited, kept with its amount, the days it was in
--      force, what was spent in those days (when replaced) and who set and closed it. Members of the business can
--      read it; nobody can write it directly. Rows are only ever inserted, by the two functions below.
--   3. start_new_expense_budget(business, month, amount, starts_on): Owner only. Closes the budget in force for that
--      month on the day before starts_on (recording what was spent against it), and starts the new amount on
--      starts_on. The new budget carries over to later months like any other. starts_on must be inside the month and
--      after the current budget's start; a change on the same day is an Edit.
--   4. set_expense_budget (Edit) is unchanged except that, when it changes the amount of a month that already has
--      its own budget, the previous amount is first kept in expense_budget_history ('edited'). starts_on is kept.
-- Existing rows: starts_on stays NULL (they began on the 1st), so every existing budget reads exactly as before.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * New readable data: earlier budget amounts, their dates and spending totals, visible to members of the business
--     (the same rule as expense_budgets and expenses: business_id IN current_business_ids(), or a platform admin).
--     Not visible to other businesses or anon.
--   * Writes only through SECURITY DEFINER functions with a pinned search_path that refuse anyone but the business's
--     Owner (is_business_owner, 42501). No INSERT/UPDATE/DELETE grant on either table for any app role.
--   * EXECUTE revoked from PUBLIC and anon, granted to authenticated (Supabase re-grants anon at CREATE time; the
--     REVOKE below runs after the CREATE).
--   * A per-business-and-month advisory lock serialises the two functions, so two taps cannot close one budget twice.
--
-- BEFORE IT IS APPLIED
-- --------------------
-- The app reads budgets without starts_on and hides "Set new budget" (it says the update is needed if the function
-- is missing); Edit works as before.
--
-- ROLLBACK
-- --------
--   DROP FUNCTION IF EXISTS public.start_new_expense_budget(uuid, text, numeric, date);
--   re-run the set_expense_budget section of carehub_20270103_expense_budgets.sql;
--   DROP TABLE IF EXISTS public.expense_budget_history;
--   ALTER TABLE public.expense_budgets DROP CONSTRAINT IF EXISTS expense_budgets_starts_in_month,
--     DROP COLUMN IF EXISTS starts_on;
-- (A month that had a new budget then keeps its latest amount, counted from the 1st.)
--
-- VERIFY AFTER APPLYING (then a rolled-back probe as an Owner, one of their staff and another business's owner)
--   select relrowsecurity from pg_class where relname = 'expense_budget_history';            -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'expense_budget_history';                                             -- authenticated SELECT only
--   select proname, proacl from pg_proc where proname in ('start_new_expense_budget', 'set_expense_budget');

-- ── 1. When a month's budget began ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expense_budgets ADD COLUMN IF NOT EXISTS starts_on date;
ALTER TABLE public.expense_budgets DROP CONSTRAINT IF EXISTS expense_budgets_starts_in_month;
ALTER TABLE public.expense_budgets ADD CONSTRAINT expense_budgets_starts_in_month
  CHECK (starts_on IS NULL OR to_char(starts_on, 'YYYY-MM') = month);
COMMENT ON COLUMN public.expense_budgets.starts_on IS
  'The day this month''s budget began (NULL = the 1st). Spending is counted from it to the end of the month. Set by start_new_expense_budget.';

-- ── 2. Budgets replaced or edited ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_budget_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  starts_on date NOT NULL,
  ended_on date,
  spent numeric(14,2),
  reason text NOT NULL CHECK (reason IN ('replaced', 'edited')),
  new_amount numeric(14,2) NOT NULL CHECK (new_amount >= 0),
  set_by uuid,
  set_at timestamptz,
  closed_by uuid NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR ended_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS expense_budget_history_business_month ON public.expense_budget_history (business_id, month, closed_at DESC);
COMMENT ON TABLE public.expense_budget_history IS
  'Expense budgets that were replaced by a new budget (with the days they ran and what was spent) or edited. Insert-only, by start_new_expense_budget / set_expense_budget.';

ALTER TABLE public.expense_budget_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense budget history of own business" ON public.expense_budget_history;
CREATE POLICY "expense budget history of own business" ON public.expense_budget_history
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT public.current_business_ids()) OR public.is_platform_admin());
REVOKE ALL ON public.expense_budget_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.expense_budget_history TO authenticated;

-- ── 3. Edit: unchanged, but the previous amount of the month is kept ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_expense_budget(p_business_id uuid, p_month text, p_amount numeric)
RETURNS public.expense_budgets
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_row public.expense_budgets;
  v_old public.expense_budgets;
BEGIN
  IF auth.uid() IS NULL OR p_business_id IS NULL OR NOT public.is_business_owner(p_business_id) THEN
    RAISE EXCEPTION 'Only the Owner can set the expense budget.' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'The budget month must look like 2026-11.' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'Enter a budget of 0 or more.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('expense_budget:' || p_business_id::text || ':' || p_month));
  SELECT * INTO v_old FROM public.expense_budgets WHERE business_id = p_business_id AND month = p_month FOR UPDATE;
  IF FOUND AND v_old.amount IS DISTINCT FROM round(p_amount, 2) THEN
    INSERT INTO public.expense_budget_history (business_id, month, amount, starts_on, reason, new_amount, set_by, set_at, closed_by)
    VALUES (p_business_id, p_month, v_old.amount, coalesce(v_old.starts_on, (p_month || '-01')::date), 'edited', round(p_amount, 2),
            v_old.set_by, v_old.updated_at, auth.uid());
  END IF;

  INSERT INTO public.expense_budgets (business_id, month, amount, set_by, updated_at)
  VALUES (p_business_id, p_month, round(p_amount, 2), auth.uid(), now())
  ON CONFLICT (business_id, month)
    DO UPDATE SET amount = EXCLUDED.amount, set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.set_expense_budget(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_expense_budget(uuid, text, numeric) TO authenticated;

-- ── 4. Set new budget ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_new_expense_budget(p_business_id uuid, p_month text, p_amount numeric, p_starts_on date)
RETURNS public.expense_budgets
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_cur public.expense_budgets;
  v_cur_start date;
  v_spent numeric;
  v_row public.expense_budgets;
BEGIN
  IF auth.uid() IS NULL OR p_business_id IS NULL OR NOT public.is_business_owner(p_business_id) THEN
    RAISE EXCEPTION 'Only the Owner can set the expense budget.' USING ERRCODE = '42501';
  END IF;
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'The budget month must look like 2026-11.' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'Enter a new budget above 0.' USING ERRCODE = '22023';
  END IF;
  IF p_starts_on IS NULL OR to_char(p_starts_on, 'YYYY-MM') <> p_month THEN
    RAISE EXCEPTION 'The new budget must start within %.', p_month USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('expense_budget:' || p_business_id::text || ':' || p_month));

  -- The budget in force for the month: its own, else the latest earlier one (carried over).
  SELECT * INTO v_cur FROM public.expense_budgets
   WHERE business_id = p_business_id AND month <= p_month ORDER BY month DESC LIMIT 1;
  IF NOT FOUND OR v_cur.amount <= 0 THEN
    RAISE EXCEPTION 'There is no budget for % to replace. Use Set budget.', p_month USING ERRCODE = '22023';
  END IF;
  v_cur_start := CASE WHEN v_cur.month = p_month THEN coalesce(v_cur.starts_on, (p_month || '-01')::date) ELSE (p_month || '-01')::date END;
  IF p_starts_on <= v_cur_start THEN
    RAISE EXCEPTION 'A new budget must start after the current one (from %). To change the current budget, use Edit budget.', to_char(v_cur_start, 'YYYY-MM-DD') USING ERRCODE = '22023';
  END IF;

  -- What was spent against the budget being closed, by the date each expense belongs to.
  SELECT coalesce(sum(e.amount), 0) INTO v_spent
    FROM public.expenses e
   WHERE e.business_id = p_business_id
     AND public.expense_effective_date(e.date, e.created_at) >= v_cur_start
     AND public.expense_effective_date(e.date, e.created_at) < p_starts_on;

  INSERT INTO public.expense_budget_history (business_id, month, amount, starts_on, ended_on, spent, reason, new_amount, set_by, set_at, closed_by)
  VALUES (p_business_id, p_month, v_cur.amount, v_cur_start, p_starts_on - 1, round(v_spent, 2), 'replaced', round(p_amount, 2),
          v_cur.set_by, v_cur.updated_at, auth.uid());

  INSERT INTO public.expense_budgets (business_id, month, amount, starts_on, set_by, updated_at)
  VALUES (p_business_id, p_month, round(p_amount, 2), p_starts_on, auth.uid(), now())
  ON CONFLICT (business_id, month)
    DO UPDATE SET amount = EXCLUDED.amount, starts_on = EXCLUDED.starts_on, set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.start_new_expense_budget(uuid, text, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_new_expense_budget(uuid, text, numeric, date) TO authenticated;
