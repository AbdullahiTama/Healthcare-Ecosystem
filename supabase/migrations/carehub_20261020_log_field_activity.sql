-- APPLIED TO PRODUCTION 2026-10-20 as carehub_20261020_log_field_activity (version 20261020154254). Verified by reading the catalog back and by a
-- rolled-back behavioural run against the live policies. The applied copy carries a shorter header comment;
-- the statements are identical.
-- Audit findings F4 and F6 (docs/audits/live-field-activity-audit.md).
--
-- WHAT IS WRONG TODAY
--   Saving a report is two separate requests: the activity, then its viewers. (F4) The app made that
--   retry-safe, but it is still two transactions. (F6) Realtime checks a subscriber's access when the
--   activity row is published; the viewer rows that grant a tagged non-manager access arrive after it, so
--   that person gets no live push and sees the report only on the next catch-up or reload.
--
-- WHAT THIS ADDS
--   log_field_activity(p_activity jsonb, p_viewers jsonb) saves the activity and its viewers in ONE
--   transaction, so the tagged person already has access when the report becomes visible.
--     * Idempotent: the activity id comes from the caller; the same id twice is one row (ON CONFLICT DO
--       NOTHING), and only viewers not already present are added. An edited retry changes nothing, exactly
--       as with the REST path.
--     * SECURITY INVOKER, on purpose: every existing row level security policy still decides, including
--       "a rep cannot log as someone else" and "only the author or a see-all person tags viewers". It adds
--       no access of its own.
--     * Reports alerts: 'server' when the alert triggers (carehub_20261020_activity_server_alerts) exist, else
--       'client', so the app knows whether it still has to try to tell people itself.
--   An explicit column list is used, not jsonb_populate_record: a record populated from partial JSON would
--   null out columns that have defaults (created_at).
--
-- HOW IT PAIRS WITH THE APP
--   Nothing calls it until the app is changed to; applying it alone changes no behaviour. The app should try
--   it first and fall back to the two-request path if the function does not exist (PGRST202), so release
--   order does not matter. Whether Realtime then delivers the push to a tagged non-manager must be checked
--   on a live pair of sessions; a scratch-database test cannot show it.
--
-- Rollback: DROP FUNCTION public.log_field_activity(jsonb, jsonb);

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
    directory_business_id, directory_business_name)
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
    p_activity ->> 'directory_business_name')
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
  IF has_function_privilege('anon', 'public.log_field_activity(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'log_field_activity must not be executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.log_field_activity(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'log_field_activity must be executable by authenticated';
  END IF;
END $$;
