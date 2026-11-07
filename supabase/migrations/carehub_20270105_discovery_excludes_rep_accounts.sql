-- Facility Discovery never lists representative accounts (or deleted businesses).
-- 2027-01-05 (sequence date). Found 2026-11-07 in the live end-to-end check of the importer operating models
-- (docs/architecture/Importer-Operating-Models.md §11).
--
-- Status: APPLIED to the live carehub project 2026-11-07 as carehub_20270105_discovery_excludes_rep_accounts, with the
-- owner's approval. Verified: grants unchanged (postgres, authenticated, service_role); a Lagos search returns 11
-- businesses and no representative account; the live app's Facility Discovery no longer lists the QA rep accounts.
-- PGlite: apps/carefind/src/test/operating-models/discoveryExcludesRepAccounts.db.test.js.
--
-- PROBLEM
--   discover_facilities_cursor (SECURITY DEFINER, executable by every signed-in user) searches every businesses row.
--   Since carehub_20270102 a representative's private account under the Decentralised model is a businesses row
--   (account_kind = 'rep_account'), so any company searching an area could see it as a "facility": its name (company
--   name and the representative's), city, address and phone. That breaks the spec's privacy rule for representative
--   accounts (4.1, 6). Until 2026-11-07 a client bug (blank filters sent as '') hid almost every row, which is why it
--   was not seen; with that bug fixed the first Lagos result was the QA representative's account.
--   Soft-deleted businesses (deleted_at set) were listed too.
--
-- FIX
--   The live body, unchanged apart from one condition in both queries (the count and the page):
--   account_kind = 'business' AND deleted_at IS NULL. Parameters, return shape, ordering and paging are the same.
--   CREATE OR REPLACE keeps the existing grants (postgres, authenticated, service_role; not anon).
--
-- SECURITY
--   Narrows what the function returns; widens nothing. It still lists unlisted and pending tenants as before (finding
--   S1 in CareHub-Enterprise-Implementation-Baseline.md; a product decision, not changed here).
--
-- ROLLBACK
--   Re-run the same function without the two `account_kind = 'business' AND deleted_at IS NULL` lines.

CREATE OR REPLACE FUNCTION public.discover_facilities_cursor(p_state text DEFAULT NULL::text, p_lga text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_category text DEFAULT 'all'::text, p_keyword text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    account_kind = 'business' AND deleted_at IS NULL
    AND (p_state IS NULL OR state ILIKE '%' || p_state || '%')
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
      account_kind = 'business' AND deleted_at IS NULL
      AND (p_state IS NULL OR state ILIKE '%' || p_state || '%')
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
$function$;
