-- Baseline finding S1/S2 (docs/architecture/CareHub-Enterprise-Implementation-Baseline.md).
--
-- discover_facilities_cursor is SECURITY DEFINER and reads every businesses row
-- (tenants included), returning phone and coordinates. It was created with no
-- REVOKE, so Postgres' default EXECUTE-to-PUBLIC applied and an anonymous
-- caller could enumerate every tenant's contact details. Its only caller
-- (apps/carehub/src/lib/places.js) runs for a signed-in user, so execution is
-- restricted to `authenticated`.
--
-- Also fixed, with the signature and return shape unchanged:
--   * p_limit is clamped to 1..100 (it was unbounded);
--   * p_cursor that is not a non-negative integer is treated as 0 instead of
--     raising "invalid input syntax";
--   * % _ \ in text filters are escaped, so a caller cannot widen a filter
--     with wildcards.
--
-- Rollback: re-run carehub_20260905_facility_discovery_cursor_pagination.sql,
-- then GRANT EXECUTE ON FUNCTION public.discover_facilities_cursor(text,text,text,text,text,integer,text) TO PUBLIC;
-- NOT APPLIED. Apply only with explicit approval; verify afterwards with
--   select has_function_privilege('anon', 'public.discover_facilities_cursor(text,text,text,text,text,integer,text)', 'execute');  -- expect false

CREATE OR REPLACE FUNCTION public.discover_facilities_cursor(
  p_state text DEFAULT NULL,
  p_lga text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_category text DEFAULT 'all',
  p_keyword text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset integer := 0;
  v_total integer;
  v_rows jsonb;
  v_has_more boolean;
  -- NULLIF turns the empty strings the client sends for "unset" into NULL.
  v_state text := NULLIF(p_state, '');
  v_lga text := NULLIF(p_lga, '');
  v_city text := NULLIF(p_city, '');
  v_cat text := NULLIF(p_category, '');
  v_kw text := NULLIF(p_keyword, '');
  esc text := '([\%_])';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_cursor IS NOT NULL AND p_cursor ~ '^[0-9]{1,9}$' THEN
    v_offset := p_cursor::integer;
  END IF;

  v_state := regexp_replace(v_state, esc, '\\1', 'g');
  v_lga   := regexp_replace(v_lga,   esc, '\\1', 'g');
  v_city  := regexp_replace(v_city,  esc, '\\1', 'g');
  v_cat   := regexp_replace(v_cat,   esc, '\\1', 'g');
  v_kw    := regexp_replace(v_kw,    esc, '\\1', 'g');

  SELECT COUNT(*) INTO v_total
  FROM public.businesses
  WHERE
    (v_state IS NULL OR state ILIKE '%' || v_state || '%')
    AND (v_lga IS NULL OR lga ILIKE '%' || v_lga || '%')
    AND (v_city IS NULL OR city ILIKE '%' || v_city || '%')
    AND (v_cat IS NULL OR v_cat = 'all' OR category ILIKE '%' || v_cat || '%' OR business_type ILIKE '%' || v_cat || '%')
    AND (v_kw IS NULL OR name ILIKE '%' || v_kw || '%' OR city ILIKE '%' || v_kw || '%' OR state ILIKE '%' || v_kw || '%');

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT id, name, business_type, state, city, lga, area, address, phone,
           latitude, longitude, lat, lng, category, website,
           created_at
    FROM public.businesses
    WHERE
      (v_state IS NULL OR state ILIKE '%' || v_state || '%')
      AND (v_lga IS NULL OR lga ILIKE '%' || v_lga || '%')
      AND (v_city IS NULL OR city ILIKE '%' || v_city || '%')
      AND (v_cat IS NULL OR v_cat = 'all' OR category ILIKE '%' || v_cat || '%' OR business_type ILIKE '%' || v_cat || '%')
      AND (v_kw IS NULL OR name ILIKE '%' || v_kw || '%' OR city ILIKE '%' || v_kw || '%' OR state ILIKE '%' || v_kw || '%')
    ORDER BY created_at DESC, id
    LIMIT v_limit OFFSET v_offset
  ) t;

  v_has_more := (v_offset + v_limit) < v_total;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'hasMore', v_has_more,
    'nextCursor', CASE WHEN v_has_more THEN (v_offset + v_limit)::text ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.discover_facilities_cursor(text, text, text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discover_facilities_cursor(text, text, text, text, text, integer, text) TO authenticated;
