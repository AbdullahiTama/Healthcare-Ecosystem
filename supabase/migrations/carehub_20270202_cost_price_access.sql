-- ─────────────────────────────────────────────────────────────────────────────
-- Cost price: who may read it, and the one way to read it (CODE_AUDIT A25, part 1 of 2).
-- 2026-11-22. Docs: docs/architecture/Cost-Price-Access.md
-- Status: NOT APPLIED. Tested on PGlite (apps/carefind/src/test/cost-price/costPriceAccess.db.test.js).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- products.cost_price could be read by (1) every signed-in user of any business, through the policy "public can view
-- listed products" (verified live 2026-11-22: a user with no business read 11,122 costs across 14 businesses), and
-- (2) every staff member of a business, although the app shows cost only to the Owner and roles with "See cost prices"
-- (canViewCostPrice). Part 2 (carehub_20270203_cost_price_column_guard) stops the API roles reading the column; this
-- part adds what the app reads costs through instead, so the app can move first.
--
-- WHAT (additive only; nothing existing changes)
-- * can_view_cost_price(business): the app's rule (lib/permissions.js getPerms + canViewCostPrice), for a member of
--   the business (current_business_ids):
--     - its Owner (is_business_owner: owner of it or a parent business, or active staff with role 'Owner');
--     - active staff of it or of a parent business whose role is 'Owner';
--     - active staff whose role has a custom roles row (that staff member's business): that row's canViewCostPrice;
--     - active staff with no custom row and the preset role 'Manager' (the only preset with the switch on).
-- * product_costs(business, ids): { "<product id>": cost } for the business's products (all, or the given ids) with a
--   cost set, to those people; {} to anyone else. One jsonb value, so PostgREST's row limit does not cut it short.
--
-- SECURITY
-- Both SECURITY DEFINER with a pinned search_path and the caller's identity from auth.uid()/auth.email(); scoped to the
-- one business asked for, and only for a member of it. EXECUTE for authenticated only (not anon, not PUBLIC).
--
-- ROLLBACK
--   DROP FUNCTION public.product_costs(uuid, uuid[]); DROP FUNCTION public.can_view_cost_price(uuid);
--   (only after part 2 is rolled back and the app no longer calls product_costs).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_view_cost_price(p_business_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE ancestry AS (
    SELECT b.id, b.parent_business_id, 0 AS depth FROM public.businesses b WHERE b.id = p_business_id
    UNION ALL
    SELECT p.id, p.parent_business_id, a.depth + 1
      FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
  )
  SELECT auth.uid() IS NOT NULL
     AND p_business_id IN (SELECT public.current_business_ids())
     AND (
       public.is_business_owner(p_business_id)
       OR EXISTS (
         SELECT 1
           FROM public.staff s
           JOIN ancestry a ON a.id = s.business_id
           LEFT JOIN public.roles r ON r.business_id = s.business_id AND r.name = s.role
          WHERE s.status = 'active'
            AND lower(s.email) = lower(btrim(auth.email()))
            AND (
              s.role = 'Owner'
              OR (r.id IS NOT NULL AND (r.permissions ->> 'canViewCostPrice') = 'true')
              OR (r.id IS NULL AND s.role = 'Manager')
            ))
     )
$$;

COMMENT ON FUNCTION public.can_view_cost_price(uuid) IS
  'May the caller see cost prices of this business? Same rule as the app (lib/permissions.js canViewCostPrice). carehub_20270202.';

CREATE OR REPLACE FUNCTION public.product_costs(p_business_id uuid, p_product_ids uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_business_id IS NULL OR NOT public.can_view_cost_price(p_business_id) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_object_agg(p.id::text, p.cost_price)
      FROM public.products p
     WHERE p.business_id = p_business_id
       AND p.cost_price IS NOT NULL
       AND (p_product_ids IS NULL OR p.id = ANY (p_product_ids))
  ), '{}'::jsonb);
END $$;

COMMENT ON FUNCTION public.product_costs(uuid, uuid[]) IS
  'Cost prices of a business''s products, { id: cost }, to the Owner and roles allowed to see costs; {} to anyone else. carehub_20270202.';

REVOKE ALL ON FUNCTION public.can_view_cost_price(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_costs(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_cost_price(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_costs(uuid, uuid[]) TO authenticated;
