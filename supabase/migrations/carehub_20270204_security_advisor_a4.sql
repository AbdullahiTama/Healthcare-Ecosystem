-- ─────────────────────────────────────────────────────────────────────────────
-- Security advisor findings (CODE_AUDIT A4): fix what is actionable, record what is accepted.
-- 2026-11-23. Docs: docs/architecture/Security-Advisor-Baseline.md
-- Status: NOT APPLIED. Tested on PGlite (apps/carefind/src/test/security/securityAdvisorA4.db.test.js).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY (advisor run 2026-11-23, verified against the function bodies and grants)
-- 1. Grant drift: 20260906_shop_recommendations.sql meant track_product_view / track_purchase_pattern for signed-in
--    users and auto_generate_recommendations for the server only, but `REVOKE ... FROM PUBLIC` does not remove the
--    direct EXECUTE Supabase gives anon on new functions, so all three were callable by anyone:
--    * track_purchase_pattern(order): anyone could call it again and again for any order, inflating "frequently bought
--      together" (no caller check). Only the payment server calls it (packages/shared-payments effects, service role).
--    * auto_generate_recommendations(product): no caller; writes shop_product_relationships. Server only.
--    * track_product_view(product, user, session): stored the user id passed in, so anyone could write views under
--      another customer's id.
-- 2. shop_product_views_select allowed every signed-in user to read every row (which customer viewed which product):
--    browsing history on a health marketplace. Only the admin server reads the table (service role).
-- 3. Three functions without a pinned search_path (advisor WARN).
-- 4. notify_stock_alerts_on_restock is a trigger function callable by API roles (it cannot be run through the API, but
--    there is no reason for the grant).
-- 5. get_admin_shop_overview() has no caller check: any signed-in user could read marketplace-wide revenue, commission,
--    order and customer counts. Only the admin server calls it (api/_handlers/admin-auth.js, service role).
--
-- WHAT
-- * track_purchase_pattern, auto_generate_recommendations: EXECUTE for service_role only.
-- * track_product_view: records the caller's own id (auth.uid(), NULL when signed out); p_user_id is kept in the
--   signature for the existing client and ignored. Still callable by anon and authenticated (shop pages record views
--   for signed-out visitors too).
-- * shop_product_views_select: a signed-in user reads only their own views.
-- * search_path pinned (public, pg_temp) on create_shop_order (the 19-argument wrapper), shop_order_receipts_guard,
--   plan_enforcement_started_at. None of them uses anything from the extensions schema.
-- * notify_stock_alerts_on_restock: EXECUTE revoked from PUBLIC, anon, authenticated (the trigger still fires).
-- * get_admin_shop_overview: EXECUTE for service_role only.
--
-- FOLLOW-UP (not changed here): adr_icsr_missing(report) reads any ADR report as owner and returns which fields are
-- empty (no values). Revoking it would break submit_adr_report (SECURITY INVOKER, calls it as the user); an access check
-- must also allow submit_adr_public_report's anonymous path. Low: the caller needs the report's random id.
--
-- ACCEPTED (recorded in docs/architecture/Security-Advisor-Baseline.md; not changed here)
-- carefind_products and adr_pv_case_view as SECURITY DEFINER views; spatial_ref_sys without RLS (PostGIS-owned);
-- pg_trgm / postgis in public; the remaining anon-executable functions (public by design, each listed with its reason);
-- authenticated-executable SECURITY DEFINER functions (each writer checks its caller, directly or through a helper).
-- Leaked-password protection is a Supabase Auth dashboard setting (owner step).
--
-- SECURITY
-- Narrows access only: three functions lose anon/authenticated EXECUTE, one stops trusting a client-supplied user id,
-- one policy narrows, one trigger function loses API EXECUTE. No new grants except service_role on two functions.
--
-- ROLLBACK
--   GRANT EXECUTE ON FUNCTION public.track_purchase_pattern(uuid), public.auto_generate_recommendations(uuid) TO anon, authenticated;
--   Restore track_product_view from apps/carehub/sql/20260906_shop_recommendations.sql (inserts p_user_id).
--   ALTER POLICY shop_product_views_select ON public.shop_product_views USING (true);
--   ALTER FUNCTION ... RESET search_path (the three above);
--   GRANT EXECUTE ON FUNCTION public.notify_stock_alerts_on_restock() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_admin_shop_overview() TO anon, authenticated;
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Server-only recommendation writers.
REVOKE ALL ON FUNCTION public.track_purchase_pattern(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_generate_recommendations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_purchase_pattern(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_generate_recommendations(uuid) TO service_role;

-- 2. A view is recorded under the caller's own id, never one passed in.
CREATE OR REPLACE FUNCTION public.track_product_view(p_product_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_session_id text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- p_user_id is ignored (kept for the existing client): the id is the caller's (carehub_20270204).
  INSERT INTO public.shop_product_views (product_id, user_id, session_id)
  VALUES (p_product_id, auth.uid(), left(p_session_id, 200));
END;
$$;
REVOKE ALL ON FUNCTION public.track_product_view(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_product_view(uuid, uuid, text) TO anon, authenticated, service_role;

-- 3. Browsing history is private: each signed-in user reads only their own views.
ALTER POLICY shop_product_views_select ON public.shop_product_views USING (user_id = (SELECT auth.uid()));

-- 4. Pinned search_path.
ALTER FUNCTION public.create_shop_order(uuid, uuid, jsonb, integer, integer, integer, integer, integer, text, text, text, text, text, text, text, numeric, boolean, text, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.shop_order_receipts_guard() SET search_path = public, pg_temp;
ALTER FUNCTION public.plan_enforcement_started_at() SET search_path = public, pg_temp;

-- 5. A trigger function needs no API grant.
REVOKE ALL ON FUNCTION public.notify_stock_alerts_on_restock() FROM PUBLIC, anon, authenticated;

-- 6. Marketplace totals are for the admin server.
REVOKE ALL ON FUNCTION public.get_admin_shop_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_shop_overview() TO service_role;
