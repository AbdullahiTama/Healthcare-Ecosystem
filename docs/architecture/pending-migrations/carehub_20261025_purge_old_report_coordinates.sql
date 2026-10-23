-- carehub_20261025_purge_old_report_coordinates  (DRAFT, not applied, NOT SCHEDULED)
--
-- Retention for the person's position on field reports: removes it from reports older than N months and keeps
-- everything else (the text, the place chosen, who, when, the verification outcome). The period N is the
-- owner's decision (docs/privacy/field-activity-location.md); nothing runs this function by itself.
--
-- What it clears on public.field_activities older than the cutoff:
--   lat, lng, gps_accuracy_m                       the person's own position and the fix's accuracy
--   facility_lat, facility_lng, place_coords       ONLY where facility_source = 'rep_added': a place a rep
--                                                  added sits at the rep's own GPS pin, so those ARE the
--                                                  person's position. A place from map data, and a chosen
--                                                  directory business, are places, not the person: kept.
--
-- What it deliberately does NOT touch:
--   public.staff_checkins  every captured row must carry coordinates (a table constraint) and the table refuses
--                          UPDATE and DELETE by trigger. Retention there needs an audited exception to a security
--                          control: a separate decision, not made here.
--   public.location_access_log  the record of who looked at whose position.
--
-- Safety: p_months below 1 is refused (so a typo cannot wipe everything); only the service role can run it;
-- it is idempotent (rows already cleared are not counted again) and returns how many rows it changed.
--
-- Rollback: DROP FUNCTION public.purge_old_report_coordinates(integer);  (cleared positions cannot be restored)

CREATE OR REPLACE FUNCTION public.purge_old_report_coordinates(p_months integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cutoff timestamptz;
  v_rows integer;
BEGIN
  IF p_months IS NULL OR p_months < 1 THEN
    RAISE EXCEPTION 'p_months must be at least 1' USING ERRCODE = '22023';
  END IF;
  v_cutoff := now() - make_interval(months => p_months);

  UPDATE public.field_activities a
     SET lat = NULL,
         lng = NULL,
         gps_accuracy_m = NULL,
         facility_lat = CASE WHEN a.facility_source = 'rep_added' THEN NULL ELSE a.facility_lat END,
         facility_lng = CASE WHEN a.facility_source = 'rep_added' THEN NULL ELSE a.facility_lng END,
         place_coords = CASE WHEN a.facility_source = 'rep_added' THEN NULL ELSE a.place_coords END
   WHERE a.created_at < v_cutoff
     AND (a.lat IS NOT NULL OR a.lng IS NOT NULL OR a.gps_accuracy_m IS NOT NULL
          OR (a.facility_source = 'rep_added'
              AND (a.facility_lat IS NOT NULL OR a.facility_lng IS NOT NULL OR a.place_coords IS NOT NULL)));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- Supabase re-grants EXECUTE to anon/authenticated at creation, after any earlier REVOKE: remove it explicitly.
REVOKE ALL ON FUNCTION public.purge_old_report_coordinates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_report_coordinates(integer) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'field_activities' AND column_name = 'gps_accuracy_m'
  ) THEN
    RAISE EXCEPTION 'apply carehub_20261023_activity_gps_accuracy first: this function clears gps_accuracy_m';
  END IF;
  IF has_function_privilege('anon', 'public.purge_old_report_coordinates(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_old_report_coordinates(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'purge_old_report_coordinates must be executable only by the service role';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'purge_old_report_coordinates') <> 1 THEN
    RAISE EXCEPTION 'purge_old_report_coordinates must have exactly one overload';
  END IF;
END $$;
