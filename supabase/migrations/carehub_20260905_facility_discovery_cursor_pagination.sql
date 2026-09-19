-- CareFind Smart Facility Discovery — server-side cursor pagination
-- Replaces client-side limit:100 hack with true paginated RPC.
-- Usage: SELECT * FROM discover_facilities_cursor('Lagos', 'Ikeja', NULL, 'all', NULL, 20, NULL);

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
  v_result jsonb;
  v_offset integer := 0;
  v_total integer;
  v_rows jsonb;
  v_has_more boolean;
BEGIN
  IF p_cursor IS NOT NULL THEN
    v_offset := COALESCE(p_cursor::integer, 0);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.businesses
  WHERE
    (p_state IS NULL OR state ILIKE '%' || p_state || '%')
    AND (p_lga IS NULL OR lga ILIKE '%' || p_lga || '%')
    AND (p_city IS NULL OR city ILIKE '%' || p_city || '%')
    AND (p_category IS NULL OR p_category = 'all' OR category ILIKE '%' || p_category || '%' OR business_type ILIKE '%' || p_category || '%')
    AND (p_keyword IS NULL OR name ILIKE '%' || p_keyword || '%' OR city ILIKE '%' || p_keyword || '%' OR state ILIKE '%' || p_keyword || '%');

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT id, name, business_type, state, city, lga, area, address, phone,
           latitude, longitude, lat, lng, category, website,
           created_at
    FROM public.businesses
    WHERE
      (p_state IS NULL OR state ILIKE '%' || p_state || '%')
      AND (p_lga IS NULL OR lga ILIKE '%' || p_lga || '%')
      AND (p_city IS NULL OR city ILIKE '%' || p_city || '%')
      AND (p_category IS NULL OR p_category = 'all' OR category ILIKE '%' || p_category || '%' OR business_type ILIKE '%' || p_category || '%')
      AND (p_keyword IS NULL OR name ILIKE '%' || p_keyword || '%' OR city ILIKE '%' || p_keyword || '%' OR state ILIKE '%' || p_keyword || '%')
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET v_offset
  ) t;

  v_has_more := (v_offset + p_limit) < v_total;

  v_result := jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'hasMore', v_has_more,
    'nextCursor', CASE WHEN v_has_more THEN (v_offset + p_limit)::text ELSE NULL END
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.discover_facilities_cursor IS 'Server-side cursor pagination for facility discovery. Returns {rows, total, hasMore, nextCursor}.';
