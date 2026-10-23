-- carehub_20261024_activity_photos  (DRAFT, not applied)
--
-- Proof photos on a field report: up to three, stored as privately as the voice notes.
--
--   * adds public.field_activities.photo_paths text[] NOT NULL DEFAULT '{}', at most 3 entries. It holds
--     storage object paths ('<business id>/<report id>-<n>-<suffix>.jpg'), never URLs.
--   * creates the PRIVATE bucket activity-photos: 5 MB, jpeg/png/webp only.
--   * two policies, signed-in users only (same shape as activity-voice, see
--     supabase/migrations/carehub_20261020_activity_voice_private.sql):
--       - INSERT only into a folder named after a company the person belongs to;
--       - SELECT for the uploader, or for anyone who can see a report whose photo_paths names the file AND whose
--         company is the file's own folder. The second condition matters: a report that listed another
--         company's file path would otherwise lend its viewers a way to read it.
--     No UPDATE or DELETE policy: photos are records. Cleaning up files that never got a report is a
--     service-role job.
--   * replaces public.log_field_activity(jsonb, jsonb) with the SAME signature, adding only photo_paths. The body
--     is carehub_20261023_activity_gps_accuracy plus that column, so APPLY THAT MIGRATION FIRST (this one refuses
--     to run otherwise, instead of silently dropping gps_accuracy_m again).
--
-- Order against the app does not matter: the app sends photo_paths only when a photo is attached, and the
-- function ignores keys it does not read.
--
-- Rollback: ALTER TABLE public.field_activities DROP COLUMN photo_paths; drop the two activity-photos policies;
-- remove the bucket's files and then the bucket (the service role does this); re-apply
-- carehub_20261023_activity_gps_accuracy.sql to restore the previous function.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'field_activities' AND column_name = 'gps_accuracy_m'
  ) THEN
    RAISE EXCEPTION 'apply carehub_20261023_activity_gps_accuracy first: this function replacement includes gps_accuracy_m';
  END IF;
END $$;

ALTER TABLE public.field_activities
  ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.field_activities'::regclass AND conname = 'field_activities_photo_paths_check'
  ) THEN
    ALTER TABLE public.field_activities
      ADD CONSTRAINT field_activities_photo_paths_check CHECK (cardinality(photo_paths) <= 3);
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('activity-photos', 'activity-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Drop by predicate, not by name (a wrong name is a silent no-op).
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%activity-photos%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "activity-photos insert own business" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'activity-photos'
    AND (storage.foldername(name))[1] IN (SELECT b::text FROM public.current_business_ids() AS b)
  );

-- The uploader can read what they just attached (a photo exists before its report does, and an
-- INSERT ... RETURNING must also pass this policy). After that it is exactly as visible as its report: the
-- EXISTS runs under the reader's own row level security on field_activities.
CREATE POLICY "activity-photos read own or via report" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'activity-photos'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.field_activities a
         WHERE objects.name = ANY (a.photo_paths)
           AND (storage.foldername(objects.name))[1] = a.business_id::text
      )
    )
  );

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
    directory_business_id, directory_business_name, gps_accuracy_m, photo_paths)
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
    round(NULLIF(p_activity ->> 'gps_accuracy_m', '')::numeric)::integer,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(NULLIF(p_activity -> 'photo_paths', 'null'::jsonb), '[]'::jsonb))))
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

-- Verify, do not assume.
DO $$
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'activity-photos') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'activity-photos is not private';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%activity-photos%'
       AND (roles && ARRAY['anon', 'public']::name[])
  ) THEN
    RAISE EXCEPTION 'a policy on activity-photos admits anon or public';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%activity-photos%') <> 2 THEN
    RAISE EXCEPTION 'expected exactly two activity-photos policies';
  END IF;
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
END $$;
