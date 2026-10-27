-- Sales write hardening: money columns change only through audited functions.
--
-- Design: docs/superpowers/specs/2026-10-25-pos-sales-report-design.md
-- Requires: carehub_20261210_pos_accounting.sql (record_sale_payment, refund_sale).
-- APPLIED to production 2026-10-27 (schema_migrations 20261027012946), after the
-- client that records repayments through record_sale_payment() was deployed (PR #36, 99055c2).
--
-- Why: the `sales` policy is FOR ALL to every member of the business, and the
-- table carries the default Supabase grants. So any cashier could PATCH any
-- sale's total, amount_paid, balance or items after the fact, or DELETE it. A
-- sales report built on rows anyone can rewrite is not an accounting record.
--
-- What changes (grants only; the row policy is untouched, so tenancy is the
-- same as before):
--   * anon: no privileges at all on sales. Its policy predicate already
--     failed for anon (auth.email() is NULL); this removes the grant too.
--   * authenticated: SELECT and INSERT as before. UPDATE only on the three
--     columns the app legitimately changes (hold / resume / soft-delete):
--     status, is_on_hold, notes. No DELETE, no TRUNCATE.
--   * Money changes go through record_sale_payment() and refund_sale(), both
--     SECURITY DEFINER, both writing the sale_payments ledger.
--
-- Every client write was checked on 2026-10-25: POS.jsx PATCHes only
-- {is_on_hold, status} (hold/resume/delete) and, in collectCredit,
-- {amount_paid, balance, is_credit}; that call moves to record_sale_payment in
-- the same change. No server function updates sales. Nothing deletes sales.
--
-- Rollback:
--   GRANT UPDATE, DELETE ON public.sales TO authenticated;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon;

REVOKE ALL ON public.sales FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.sales FROM authenticated;
GRANT SELECT, INSERT ON public.sales TO authenticated;
GRANT UPDATE (status, is_on_hold, notes) ON public.sales TO authenticated;
