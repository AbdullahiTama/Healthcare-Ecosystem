-- Business Discovery search (Phases 3-4). PREPARED, NOT APPLIED, NOT TESTED
-- against a real Postgres. Depends on carehub_20261120_business_directory.sql.
--
-- One read-only RPC that filters, sorts, paginates and measures distance on the
-- server, so the browser never downloads the directory to filter it.
--
--  * SECURITY INVOKER: RLS on directory_businesses still decides what the caller
--    may see (active rows for companies). The RPC adds is_active = true itself so
--    even an administrator's discovery results exclude deactivated records.
--  * No PostGIS: a bounding box on the (latitude, longitude) btree index narrows
--    candidates, then a haversine distance is computed on the survivors. Plenty
--    for a directory of this size; revisit if EXPLAIN shows otherwise at scale.
--  * Distance is STRAIGHT-LINE (great circle) metres, never road distance.
--  * Never writes. Searching creates no activity, visit, attendance or
--    notification.
--
-- Rollback: DROP FUNCTION public.directory_search(...) and public.directory_like_escape(text);

CREATE OR REPLACE FUNCTION public.directory_like_escape(t text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT regexp_replace(t, '([\\%_])', '\\\1', 'g') $$;

CREATE OR REPLACE FUNCTION public.directory_search(
  p_q text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_subcategory_id uuid DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_lga text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_place text DEFAULT NULL,          -- free text matched against address, city, LGA, state
  p_verification text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_radius_m integer DEFAULT 5000,
  p_sort text DEFAULT 'name',         -- name | distance | verified | recent
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_radius integer := LEAST(GREATEST(COALESCE(p_radius_m, 5000), 100), 100000);
  v_geo boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL;
  v_sort text := CASE WHEN p_sort IN ('name','distance','verified','recent') THEN p_sort ELSE 'name' END;
  v_dlat double precision;
  v_dlng double precision;
  v_q text := NULLIF(btrim(p_q), '');
  v_place text := NULLIF(btrim(p_place), '');
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF (p_lat IS NULL) <> (p_lng IS NULL) THEN
    RAISE EXCEPTION 'Latitude and longitude must be supplied together' USING ERRCODE = '22023';
  END IF;
  IF v_geo AND NOT (p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Coordinates out of range' USING ERRCODE = '22023';
  END IF;
  IF p_verification IS NOT NULL AND p_verification NOT IN ('unverified','pending','verified','rejected') THEN
    RAISE EXCEPTION 'Invalid verification filter' USING ERRCODE = '22023';
  END IF;
  IF v_sort = 'distance' AND NOT v_geo THEN v_sort := 'name'; END IF;

  IF v_geo THEN
    v_dlat := v_radius / 111320.0;
    v_dlng := v_radius / (111320.0 * GREATEST(cos(radians(LEAST(ABS(p_lat), 89))), 0.01));
  END IF;

  WITH matched AS (
    SELECT d.id, d.name, d.category_id, d.subcategory_id, d.business_type, d.address, d.city, d.state, d.lga,
           d.latitude, d.longitude, d.phone, d.email, d.website, d.opening_hours, d.description,
           d.verification_status, d.verified_at, d.data_source, d.created_at, d.name_normalized,
           CASE WHEN v_geo AND d.latitude IS NOT NULL THEN
             round(2 * 6371000 * asin(sqrt(least(1.0,
               power(sin(radians(d.latitude - p_lat) / 2), 2) +
               cos(radians(p_lat)) * cos(radians(d.latitude)) *
               power(sin(radians(d.longitude - p_lng) / 2), 2)))))::integer
           END AS distance_m
    FROM public.directory_businesses d
    WHERE d.is_active
      AND (v_q IS NULL OR d.name ILIKE '%' || public.directory_like_escape(v_q) || '%')
      AND (p_category_id IS NULL OR d.category_id = p_category_id)
      AND (p_subcategory_id IS NULL OR d.subcategory_id = p_subcategory_id)
      AND (NULLIF(p_state, '') IS NULL OR d.state ILIKE '%' || public.directory_like_escape(p_state) || '%')
      AND (NULLIF(p_lga, '') IS NULL OR d.lga ILIKE '%' || public.directory_like_escape(p_lga) || '%')
      AND (NULLIF(p_city, '') IS NULL OR d.city ILIKE '%' || public.directory_like_escape(p_city) || '%')
      AND (v_place IS NULL OR d.address ILIKE '%' || public.directory_like_escape(v_place) || '%'
           OR d.city ILIKE '%' || public.directory_like_escape(v_place) || '%'
           OR d.lga ILIKE '%' || public.directory_like_escape(v_place) || '%'
           OR d.state ILIKE '%' || public.directory_like_escape(v_place) || '%')
      AND (p_verification IS NULL OR d.verification_status = p_verification)
      AND (NULLIF(p_source, '') IS NULL OR d.data_source = p_source)
      AND (NOT v_geo OR (
            d.latitude BETWEEN p_lat - v_dlat AND p_lat + v_dlat
        AND d.longitude BETWEEN p_lng - v_dlng AND p_lng + v_dlng))
  ), in_range AS (
    SELECT * FROM matched WHERE NOT v_geo OR distance_m <= v_radius
  ), paged AS (
    SELECT * FROM in_range
    ORDER BY
      CASE WHEN v_sort = 'distance' THEN distance_m END ASC NULLS LAST,
      CASE WHEN v_sort = 'verified' THEN (verification_status = 'verified') END DESC NULLS LAST,
      CASE WHEN v_sort = 'recent' THEN created_at END DESC,
      name_normalized ASC, id ASC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(paged) - 'name_normalized'), '[]'::jsonb),
         (SELECT count(*) FROM in_range)
    INTO v_rows, v_total
    FROM paged;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'hasMore', (v_offset + v_limit) < v_total,
    'limit', v_limit,
    'offset', v_offset,
    'radiusM', CASE WHEN v_geo THEN v_radius END,
    'distanceBasis', CASE WHEN v_geo THEN 'straight_line' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.directory_search(text, uuid, uuid, text, text, text, text, text, text, double precision, double precision, integer, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_search(text, uuid, uuid, text, text, text, text, text, text, double precision, double precision, integer, text, integer, integer) TO authenticated;
