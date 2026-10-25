-- carehub_20261026_checkin_overview_field_manager  (closes audit finding F2)
-- APPLIED 2026-10-24 to szdybxmgmhndoytqanfb as version 20261024105118.
--
-- Team check-ins (manager_checkin_overview) admitted only the name-rule manager check (is_business_manager), so a
-- role the owner granted "Manage field team" saw everyone's field reports but not the team's check-ins. This uses
-- the field-manager rule the reports already use, caller_sees_all_activity(): platform admin, a manager role (the
-- same name rule, so nobody loses access), or a role granted "Manage field team" (can_manage_directory).
--
-- The body is the live definition read on 2026-10-24 (md5 6b5d4e35...) with ONE line changed: the access check.
-- Same signature, so CREATE OR REPLACE replaces it and no sibling is left. is_business_manager() itself is not
-- changed (facility review depends on it). Every look is still written to location_access_log.
--
-- Rollback: re-apply the CREATE OR REPLACE from supabase/migrations/carehub_20261130_staff_checkins.sql.

CREATE OR REPLACE FUNCTION public.manager_checkin_overview(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.caller_sees_all_activity(p_business_id) THEN
    RAISE EXCEPTION 'Manager access required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb), count(*)
    INTO v_rows, v_n
  FROM (
    SELECT jsonb_build_object(
      'staff_id', s.id,
      'name', s.full_name,
      'role', s.role,
      'last_checkin', CASE WHEN ok_ev.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', ok_ev.id, 'event_type', ok_ev.event_type, 'at', ok_ev.created_at,
        'latitude', ok_ev.latitude, 'longitude', ok_ev.longitude, 'accuracy_m', ok_ev.accuracy_m,
        'location_label', ok_ev.location_label, 'source', ok_ev.location_source) END,
      'age_minutes', CASE WHEN ok_ev.id IS NULL THEN NULL ELSE floor(extract(epoch FROM (now() - ok_ev.created_at)) / 60)::int END,
      'freshness', CASE WHEN ok_ev.id IS NULL THEN 'unavailable'
                        WHEN ok_ev.created_at >= now() - interval '60 minutes' THEN 'current'
                        ELSE 'stale' END,
      'last_failed_attempt', CASE WHEN bad_ev.id IS NOT NULL AND (ok_ev.id IS NULL OR bad_ev.created_at > ok_ev.created_at)
        THEN jsonb_build_object('at', bad_ev.created_at, 'reason', bad_ev.failure_reason) END,
      'last_activity_at', (SELECT max(fa.created_at) FROM public.field_activities fa WHERE fa.business_id = p_business_id AND fa.staff_id = s.id)
    ) AS x
    FROM public.staff s
    LEFT JOIN LATERAL (
      SELECT c.* FROM public.staff_checkins c
       WHERE c.business_id = p_business_id AND c.staff_id = s.id AND c.status = 'captured'
       ORDER BY c.created_at DESC LIMIT 1) ok_ev ON true
    LEFT JOIN LATERAL (
      SELECT c.* FROM public.staff_checkins c
       WHERE c.business_id = p_business_id AND c.staff_id = s.id AND c.status = 'failed'
       ORDER BY c.created_at DESC LIMIT 1) bad_ev ON true
    WHERE s.business_id = p_business_id AND s.status = 'active'
  ) t;
  INSERT INTO public.location_access_log (actor_id, business_id, action, row_count)
  VALUES (auth.uid(), p_business_id, 'checkin_overview', COALESCE(v_n, 0));
  RETURN jsonb_build_object('rows', v_rows, 'generatedAt', now(), 'currentWindowMinutes', 60);
END $function$;

-- Supabase re-grants EXECUTE to anon/authenticated at creation, after any earlier REVOKE: remove it explicitly.
REVOKE ALL ON FUNCTION public.manager_checkin_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_checkin_overview(uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'manager_checkin_overview') <> 1 THEN
    RAISE EXCEPTION 'manager_checkin_overview must have exactly one overload';
  END IF;
  IF has_function_privilege('anon', 'public.manager_checkin_overview(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'manager_checkin_overview must not be executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.manager_checkin_overview(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'manager_checkin_overview must be executable by authenticated';
  END IF;
END $$;
