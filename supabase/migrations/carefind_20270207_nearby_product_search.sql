-- ─────────────────────────────────────────────────────────────────────────────
-- Medicine search on CareFind: nearby pharmacies first, keeping relevance and availability.
-- Feedback 2026-11-25: "Search results do not sufficiently prioritise pharmacies based on the user's location."
-- Docs: docs/architecture/CareFind-Guest-Access-Nearby-Search-and-Link-Sharing.md (CODE_AUDIT A51)
-- Status: APPLIED 2026-11-26 with owner approval (version 20261126104543). Probed live as anon (rolled back), from Yaba,
-- Lagos (6.5095, 3.3711): 'paracetamol' returns 100 name / generic-name matches, nearest 15.3 km, distances never
-- decreasing among in-stock located results, top 10 all in stock; without a location 100 results; 'a,b),name.eq.x'
-- returns nothing; '100%' matches literally (2). About 0.4-0.5 s per call over 13,991 listed products (follow-up in
-- CODE_AUDIT A51 if the catalogue grows).
-- Tested on PGlite: apps/carefind/src/test/search/nearbyProductSearch.db.test.js
-- ─────────────────────────────────────────────────────────────────────────────
--
-- PROBLEM (verified in code 2026-11-25)
-- The Products search asked carefind_products for the 100 NEWEST matches (order by created_at desc, limit 100) and
-- sorted by distance in the browser only when the user turned on "Near me". With 13,988 listed products, a common
-- medicine matches far more than 100 rows, so a pharmacy next to the user was often never fetched at all, whatever
-- the sort. The search text was also placed unescaped in a PostgREST or() filter, so a comma or bracket in it broke
-- or reshaped the filter.
--
-- FIX
-- search_carefind_products(query, lat, lng, sale_type, limit) ranks EVERY match in the database, then returns the
-- best `limit` product ids with their distance. The rule (the same as apps/carefind/src/lib/nearbyRanking.js):
--   1. name or generic name matches, before a category-only match;
--   2. in stock (or stock unknown) before out of stock;
--   3. nearest first (product's own coordinates, else its business's); sellers with no known location last;
--   4. name / generic name starting with the query, before containing it;
--   5. newest first.
-- Without a location (lat/lng null or out of range), step 3 is skipped. The query is a plain substring match with
-- LIKE wildcards escaped; it is a parameter, never part of a filter string. The app then reads the rows themselves
-- from carefind_products by id, exactly as before.
--
-- SECURITY IMPLICATIONS
-- * SECURITY INVOKER: it reads carefind_products (the public view: listed products only, no cost, prescription
--   prices hidden) and businesses under the caller's own row security, so it returns nothing a caller could not
--   already read. A business hidden from the caller contributes no coordinates (its products rank as "location
--   unknown"). Returns ids, a distance and a rank number only.
-- * The caller's coordinates are used for this query only and are not stored. limit is clamped to 1..200.
-- * EXECUTE for anon and authenticated (guests may search, see carefind_20270206).
--
-- DEPLOYMENT
-- Either order works: the app calls this function and, if it does not exist yet (PGRST202 / 42883), falls back to
-- the previous query with the same ranking applied in the browser to the rows it received.
--
-- ROLLBACK
--   DROP FUNCTION public.search_carefind_products(text, double precision, double precision, text, integer);
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_carefind_products(
  p_query text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_sale_type text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (id uuid, distance_m double precision, match_rank integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      nullif(lower(btrim(coalesce(p_query, ''))), '') AS q,
      CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lat END AS ulat,
      CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lng END AS ulng,
      nullif(nullif(lower(btrim(coalesce(p_sale_type, ''))), ''), 'all') AS sale_type,
      least(greatest(coalesce(p_limit, 100), 1), 200) AS lim
  ),
  pattern AS (
    -- Escape LIKE wildcards so the query is matched literally.
    SELECT q, ulat, ulng, sale_type, lim,
           replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') AS esc
      FROM params
  ),
  matched AS (
    SELECT
      cp.id,
      cp.created_at,
      cp.stock,
      CASE
        WHEN pt.q IS NULL THEN 0
        WHEN lower(coalesce(cp.name, '')) LIKE pt.esc || '%' OR lower(coalesce(cp.generic_name, '')) LIKE pt.esc || '%' THEN 0
        WHEN lower(coalesce(cp.name, '')) LIKE '%' || pt.esc || '%' OR lower(coalesce(cp.generic_name, '')) LIKE '%' || pt.esc || '%' THEN 1
        ELSE 2
      END AS tier,
      coalesce(cp.latitude::double precision, b.latitude::double precision, b.lat::double precision) AS plat,
      coalesce(cp.longitude::double precision, b.longitude::double precision, b.lng::double precision) AS plng,
      pt.ulat, pt.ulng, pt.lim
    FROM public.carefind_products cp
    CROSS JOIN pattern pt
    LEFT JOIN public.businesses b ON b.id = cp.business_id
    WHERE (pt.q IS NULL
           OR lower(coalesce(cp.name, '')) LIKE '%' || pt.esc || '%'
           OR lower(coalesce(cp.generic_name, '')) LIKE '%' || pt.esc || '%'
           OR lower(coalesce(cp.category, '')) LIKE '%' || pt.esc || '%')
      AND (pt.sale_type IS NULL OR lower(coalesce(cp.sale_type, '')) = pt.sale_type)
  ),
  measured AS (
    SELECT m.*,
      CASE WHEN m.ulat IS NOT NULL AND m.plat BETWEEN -90 AND 90 AND m.plng BETWEEN -180 AND 180 THEN
        2 * 6371000 * asin(least(1, sqrt(
          power(sin(radians(m.plat - m.ulat) / 2), 2)
          + cos(radians(m.ulat)) * cos(radians(m.plat)) * power(sin(radians(m.plng - m.ulng) / 2), 2)
        )))
      END AS dist
    FROM matched m
  )
  SELECT ms.id, ms.dist AS distance_m, ms.tier AS match_rank
    FROM measured ms
   ORDER BY
     CASE WHEN ms.tier <= 1 THEN 0 ELSE 1 END,
     CASE WHEN ms.stock IS NOT NULL AND ms.stock <= 0 THEN 1 ELSE 0 END,
     ms.dist ASC NULLS LAST,
     ms.tier,
     ms.created_at DESC NULLS LAST,
     ms.id
   LIMIT (SELECT lim FROM params)
$$;

COMMENT ON FUNCTION public.search_carefind_products(text, double precision, double precision, text, integer) IS
  'CareFind product search: every match ranked by match strength, availability, distance from the caller (not stored), then newest; returns ids. carefind_20270207.';

REVOKE ALL ON FUNCTION public.search_carefind_products(text, double precision, double precision, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_carefind_products(text, double precision, double precision, text, integer) TO anon, authenticated, service_role;
