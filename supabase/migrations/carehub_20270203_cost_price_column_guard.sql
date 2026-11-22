-- ─────────────────────────────────────────────────────────────────────────────
-- Cost price: the API roles can no longer read products.cost_price (CODE_AUDIT A25, part 2 of 2).
-- 2026-11-22. Docs: docs/architecture/Cost-Price-Access.md
-- Status: NOT APPLIED. Apply only after carehub_20270202_cost_price_access AND the CareHub app that reads costs through
-- product_costs (no `select=*` on products) are live. Tested on PGlite (apps/carefind/src/test/cost-price/costPriceAccess.db.test.js).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- Row security decides which products a user sees, not which columns: any signed-in user could read the cost of every
-- product listed on CareFind (policy "public can view listed products"), and every staff member the costs of their
-- business. Postgres column privileges apply per database role, and every CareHub and CareFind user is the same role
-- (authenticated), so the column is closed to the API roles altogether and costs are read only through
-- product_costs(), which checks the person (part 1).
--
-- WHAT
-- * anon and authenticated: SELECT on every column of products except cost_price (granted column by column, from the
--   live column list when this runs). INSERT / UPDATE / DELETE are unchanged, so recording a purchase, importing or
--   editing a product still saves its cost.
-- * After this, `select=*` (and `return=representation` without a select list) on products fails with 42501 for the API
--   roles; the CareHub app names its columns (src/modules/inventory/productColumns.js). CareFind never read cost.
-- * A column added to products later is NOT readable by the API roles until granted:
--     GRANT SELECT (<column>) ON public.products TO anon, authenticated;
--   (recorded on the table comment). SECURITY DEFINER functions, views owned by postgres (carefind_products) and the
--   service role are unaffected.
--
-- SECURITY
-- Narrows access only. No policy changes; no new grants beyond the columns already readable.
--
-- ROLLBACK
--   GRANT SELECT ON public.products TO anon, authenticated;
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE SELECT ON public.products FROM anon, authenticated;
REVOKE SELECT (cost_price) ON public.products FROM anon, authenticated;

DO $$
DECLARE v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'products' AND column_name <> 'cost_price';
  EXECUTE format('GRANT SELECT (%s) ON public.products TO anon, authenticated', v_cols);
END $$;

COMMENT ON COLUMN public.products.cost_price IS
  'Not readable by anon/authenticated (carehub_20270203). Read through product_costs(), which checks canViewCostPrice.';
COMMENT ON TABLE public.products IS
  'API roles read products column by column (carehub_20270203): a new column needs GRANT SELECT (<col>) ON public.products TO anon, authenticated. cost_price stays ungranted.';
