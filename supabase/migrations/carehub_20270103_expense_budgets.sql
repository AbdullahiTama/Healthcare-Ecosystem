-- carehub_20270103_expense_budgets
--
-- Status: APPLIED TO PRODUCTION 2026-11-04 with the owner's approval (Supabase migration version 20261104143040),
-- applied verbatim from this file. Tested first on PGlite (apps/carefind/src/test/expenses/expenseBudgets.db.test.js)
-- with the live current_business_ids(), is_business_owner() and is_platform_admin(), read verbatim that day.
-- After applying: RLS on; authenticated SELECT only, anon nothing; set_expense_budget SECURITY DEFINER with
-- search_path public, pg_temp, EXECUTE for authenticated only. Live behavioural probe, as a real Owner, one of their
-- active staff and the owner of another business, inside DO blocks that raised and rolled back (0 rows remained):
--   1 Owner sets 2026-10 = 50,000:                 ALLOWED
--   2 Owner sets it again (55,000):                one row, 55,000 (upsert)
--   3 Owner reads 2026-11:                         2026-10 = 55,000 (carried over)
--   4-6 Owner INSERT / UPDATE / DELETE directly:   refused, permission denied
--   7 bad month 2026-13:                           refused, "The budget month must look like 2026-11."
--   8 staff member reads 2026-11:                  2026-10 = 55,000
--   9 staff member sets a budget:                  refused, 42501 "Only the Owner can set the expense budget."
--  10 staff member INSERT directly:                refused
--  11 owner of another business reads it:          0 rows
--  12 owner of another business sets it:          refused, 42501
--  13 anon reads / sets:                           refused, permission denied (table / function)
-- Security advisor afterwards: the 2026-11-04 baseline (8 groups, 208 findings) plus exactly one finding,
-- authenticated_security_definer_function_executable for set_expense_budget, which is intended (it is the app's way
-- to save a budget and refuses everyone but the Owner).
--
-- PROBLEM ("the expense budget I set suddenly disappeared")
-- ---------------------------------------------------------
-- The Expenses budget was never stored on the server. Expenses.jsx kept it in the browser's localStorage under
-- carehub_expense_budget[business_id][YYYY-MM]. Evidence (live, 2026-11-04): no table or column anywhere in public
-- holds a budget; the expense records themselves are intact (2026-10: 22 rows across 4 businesses, 2026-11: 16 rows).
-- So a budget disappeared, and its remaining balance with it, whenever:
--   * the month changed: the screen reads the budget for the month shown, and a new month had none (the report came
--     in on 4 November, after expenses were logged in October against a budget set in October);
--   * the Owner used another phone, browser or profile, cleared site data, used a private window, or the browser
--     evicted the storage (Safari removes script-written storage of sites not used for 7 days);
--   * anyone other than the Owner looked: staff never saw it, although the screen said "All staff can see the budget".
--
-- FIX
-- ---
--   1. public.expense_budgets: one row per business and month (YYYY-MM), the amount, who set it and when.
--      A month with no row of its own uses the latest earlier month's budget (the app reads month <= M, newest first),
--      so a budget carries over until the Owner changes it. A row of 0 means "no budget from this month on", which is
--      how the Owner stops a carried-over budget.
--   2. Read: every member of the business (and a platform admin), through the same rule as expenses
--      (business_id IN current_business_ids()). No client can insert, update or delete rows directly.
--   3. Write: set_expense_budget(business, month, amount), SECURITY DEFINER, Owner only (is_business_owner), validates
--      the month and the amount, upserts the row and stamps set_by / updated_at.
-- Spending is unchanged: the remaining balance is still the budget minus get_expense_totals for the month, so every
-- recorded expense reduces it and a deleted one gives it back.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * New readable data: a monthly budget figure, visible to members of the business, as the screen already promised.
--     Not visible to other businesses or to anon (no grant; RLS).
--   * Writes only through set_expense_budget, which refuses anyone who is not the business's Owner (42501). Staff,
--     including managers, cannot set or change a budget, matching the screen (the button is Owner-only).
--   * SECURITY DEFINER with a pinned search_path; EXECUTE revoked from PUBLIC and anon, granted to authenticated.
--   * No existing table, policy, grant or function is changed.

CREATE TABLE IF NOT EXISTS public.expense_budgets (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0 AND amount <= 1000000000000),
  set_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, month)
);

COMMENT ON TABLE public.expense_budgets IS
  'Monthly expense budget per business (YYYY-MM). A month without a row uses the latest earlier row; 0 = no budget. Written only by set_expense_budget (Owner).';

ALTER TABLE public.expense_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense budgets of own business" ON public.expense_budgets;
CREATE POLICY "expense budgets of own business" ON public.expense_budgets
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT public.current_business_ids()) OR public.is_platform_admin());

REVOKE ALL ON public.expense_budgets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.expense_budgets TO authenticated;

CREATE OR REPLACE FUNCTION public.set_expense_budget(p_business_id uuid, p_month text, p_amount numeric)
RETURNS public.expense_budgets
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_row public.expense_budgets;
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

  INSERT INTO public.expense_budgets (business_id, month, amount, set_by, updated_at)
  VALUES (p_business_id, p_month, round(p_amount, 2), auth.uid(), now())
  ON CONFLICT (business_id, month)
    DO UPDATE SET amount = EXCLUDED.amount, set_by = EXCLUDED.set_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.set_expense_budget(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_expense_budget(uuid, text, numeric) TO authenticated;
