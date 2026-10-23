-- carehub_20261023_activity_gps_accuracy
--
-- Keeps how accurate the GPS fix was with each field report, so a match to a place can be judged with it
-- (a fix worse than 100 m cannot confirm a match; the app shows "Location uncertain").
--
--   * adds public.field_activities.gps_accuracy_m integer, nullable, 0 to 1,000,000 metres (the same range
--     staff_checkins.accuracy_m uses). Older reports keep NULL.
--   * replaces public.log_field_activity(jsonb, jsonb) with the SAME signature, adding only that column.
--     The body is otherwise identical to the live definition read on 2026-10-23 (md5 841b96a6...), so nothing
--     else about the save changes. Same signature means CREATE OR REPLACE replaces it: no sibling is left.
--
-- Order does not matter to the app: the app sends gps_accuracy_m now; the function ignores keys it does not
-- read, so before this migration the value is simply not stored, and after it the value is stored.
--
-- Supabase re-grants EXECUTE to anon/authenticated after creation, so the REVOKE is repeated below and the
-- verification block raises (rolling everything back) if anon can call the function or two overloads exist.
--
-- Rollback: ALTER TABLE public.field_activities DROP COLUMN gps_accuracy_m; then re-apply
-- supabase/migrations/carehub_20261020_log_field_activity.sql.

ALTER TABLE public.field_activities
  ADD COLUMN IF NOT EXISTS gps_accuracy_m integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.field_activities'::regclass AND conname = 'field_activities_gps_accuracy_m_check'
  ) THEN
    ALTER TABLE public.field_activities
      ADD CONSTRAINT field_activities_gps_accuracy_m_check
      CHECK (gps_accuracy_m IS NULL OR gps_accuracy_m BETWEEN 0 AND 1000000);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.log_field_activity(p_activity jsonb, p_viewers jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid;
  v_biz uuid;
  v_inserted integer := 0;
  v_added integer := 0;
BEGIN
  IF p_activity IS NULL OR jsonb_typeof(p_activity) <> 'object' THEN
    RAISE EXCEPTION 'p_activity must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_viewers IS NULL THEN p_viewers := '[]'::jsonb; END IF;
  IF jsonb_typeof(p_viewers) <> 'array' THEN
    RAISE EXCEPTION 'p_viewers must be a JSON array' USING ERRCODE = '22023';
  END IF;

  v_id := NULLIF(p_activity ->> 'id', '')::uuid;
  v_biz := NULLIF(p_activity ->> 'business_id', '')::uuid;
  IF v_id IS NULL OR v_biz IS NULL THEN
    RAISE EXCEPTION 'id and business_id are required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.field_activities (
    id, business_id, staff_id, rep_name, rep_title, territory_id, values_json, voice_url, lat, lng,
    location_label, place_of_visit, place_coords, place_verified,
    facility_name, facility_address, facility_category, facility_lat, facility_lng, facility_distance_m,
    facility_source, facility_verified, facility_pending_review,
    directory_business_id, directory_business_name, gps_accuracy_m)
  VALUES (
    v_id, v_biz,
    NULLIF(p_activity ->> 'staff_id', '')::uuid,
    p_activity ->> 'rep_name',
    p_activity ->> 'rep_title',
    NULLIF(p_activity ->> 'territory_id', '')::uuid,
    p_activity ->> 'values_json',
    p_activity ->> 'voice_url',
    (p_activity ->> 'lat')::double precision,
    (p_activity ->> 'lng')::double precision,
    p_activity ->> 'location_label',
    p_activity ->> 'place_of_visit',
    NULLIF(p_activity -> 'place_coords', 'null'::jsonb),
    COALESCE((p_activity ->> 'place_verified')::boolean, false),
    p_activity ->> 'facility_name',
    p_activity ->> 'facility_address',
    p_activity ->> 'facility_category',
    (p_activity ->> 'facility_lat')::double precision,
    (p_activity ->> 'facility_lng')::double precision,
    (p_activity ->> 'facility_distance_m')::integer,
    p_activity ->> 'facility_source',
    COALESCE((p_activity ->> 'facility_verified')::boolean, false),
    COALESCE((p_activity ->> 'facility_pending_review')::boolean, false),
    NULLIF(p_activity ->> 'directory_business_id', '')::uuid,
    p_activity ->> 'directory_business_name',
    round(NULLIF(p_activity ->> 'gps_accuracy_m', '')::numeric)::integer)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Only the viewers not already on the report, so a retry never tags anyone twice (the table has no
  -- unique (activity_id, staff_id)). Who may tag whom is decided by the existing policy on activity_viewers.
  INSERT INTO public.activity_viewers (activity_id, staff_id, viewer_name)
  SELECT v_id, w.staff_id, COALESCE(w.viewer_name, '')
    FROM jsonb_to_recordset(p_viewers) AS w(staff_id uuid, viewer_name text)
   WHERE w.staff_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.activity_viewers v WHERE v.activity_id = v_id AND v.staff_id = w.staff_id);
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object(
    'id', v_id,
    'created', v_inserted > 0,
    'viewers_added', v_added,
    'alerts', CASE WHEN EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgname = 'trg_activity_viewers_alert' AND tgrelid = 'public.activity_viewers'::regclass AND NOT tgisinternal)
      THEN 'server' ELSE 'client' END);
END $$;

-- Supabase re-grants EXECUTE to anon/authenticated at creation, after any earlier REVOKE: remove it explicitly.
REVOKE ALL ON FUNCTION public.log_field_activity(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_field_activity(jsonb, jsonb) TO authenticated, service_role;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'log_field_activity') <> 1 THEN
    RAISE EXCEPTION 'log_field_activity must have exactly one overload';
  END IF;
  IF has_function_privilege('anon', 'public.log_field_activity(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'log_field_activity must not be executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.log_field_activity(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'log_field_activity must be executable by authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'field_activities' AND column_name = 'gps_accuracy_m'
  ) THEN
    RAISE EXCEPTION 'field_activities.gps_accuracy_m is missing';
  END IF;
END $$;
