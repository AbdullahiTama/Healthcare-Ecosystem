-- Field activity access hardening (baseline findings S3-S5). PREPARED, NOT APPLIED.
-- Reworked 2026-10-19 against the LIVE schema (renamed from 20261125). Approved in principle by
-- the product owner; to be applied only after the rolled-back live run is reviewed.
--
-- WHAT IS WRONG TODAY (confirmed on the live project)
--   field_activities, activity_viewers, activity_reactions, activity_comments each have ONE
--   permissive business-wide FOR ALL policy ("... of own business" / "... via parent
--   field_activities"). Any member of a company can therefore read every colleague's activity
--   (including GPS), log, react or comment as another person, tag themselves onto an activity,
--   and edit or delete any activity. Live data is small (11 activities, one company, one author),
--   so the blast radius of changing this now is tiny.
--
-- WHAT THIS CHANGES
--   A person sees an activity only if they wrote it, were tagged as a viewer, or "see all" for the
--   business: a manager (role contains "manager", or the owner), a directory manager
--   (can_manage_directory), or a platform admin. Writes are attributed to the caller. Activities
--   cannot be edited or deleted by members (no app code or database function does so). Only the
--   author or a see-all person decides who is tagged; reactions/comments are removable by their
--   author or a see-all person.
--
-- WHY directory managers are in the allow-list
--   The live coverage reports (directory_unvisited, directory_coverage_summary, directory_rep_activity,
--   directory_visit_totals) are SECURITY INVOKER and read field_activities as the caller. Without
--   this, a directory manager who is not a "manager" role would silently get understated coverage.
--
-- METHOD
--   RESTRICTIVE policies are ANDed with the existing permissive ones, so nothing is dropped by name
--   (a DROP POLICY IF EXISTS on a wrong name is a silent no-op). They are TO authenticated; anon
--   still gets nothing from the permissive policy.
--   is_business_manager() is NOT executable by authenticated on the live project, so it must never
--   appear in a policy expression. The SECURITY DEFINER wrapper below is used instead.
--
-- KNOWN CONSEQUENCES
--   * Realtime evaluates RLS at insert time and activity_viewers rows are written just AFTER the
--     activity, so a tagged non-manager sees it on their next load, not as a live push. See-all
--     people are unaffected.
--   * actor_name on reactions/comments is still client-supplied (display only).
--
-- Rollback: DROP POLICY <name>_restrict ON <table> for each policy below; DROP FUNCTION the helpers.

-- The caller's active staff id in a business; NULL for the owner or a non-member.
CREATE OR REPLACE FUNCTION public.caller_staff_id(bid uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT s.id FROM public.staff s
   WHERE s.business_id = bid AND lower(s.email) = lower(auth.email()) AND s.status = 'active'
   LIMIT 1
$$;

-- Everyone who may see ALL activity of a business. Wraps is_business_manager(), which signed-in
-- users cannot execute directly.
CREATE OR REPLACE FUNCTION public.caller_sees_all_activity(bid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_platform_admin() OR public.is_business_manager(bid) OR public.can_manage_directory(bid)
$$;

-- True when the caller was tagged as a viewer of the activity. SECURITY DEFINER so the
-- field_activities policy can ask about activity_viewers without the two tables' policies recursing.
CREATE OR REPLACE FUNCTION public.is_activity_viewer(aid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.activity_viewers v
    JOIN public.field_activities a ON a.id = v.activity_id
    WHERE v.activity_id = aid
      AND public.caller_staff_id(a.business_id) IS NOT NULL
      AND v.staff_id = public.caller_staff_id(a.business_id))
$$;

CREATE OR REPLACE FUNCTION public.activity_business(aid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT business_id FROM public.field_activities WHERE id = aid $$;

CREATE OR REPLACE FUNCTION public.activity_author(aid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT staff_id FROM public.field_activities WHERE id = aid $$;

-- Supabase re-grants EXECUTE to anon/authenticated at function creation: remove anon and PUBLIC
-- explicitly, then give signed-in users (who run the policies) and the server what they need.
REVOKE ALL ON FUNCTION public.caller_staff_id(uuid), public.caller_sees_all_activity(uuid),
  public.is_activity_viewer(uuid), public.activity_business(uuid), public.activity_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_staff_id(uuid), public.caller_sees_all_activity(uuid),
  public.is_activity_viewer(uuid), public.activity_business(uuid), public.activity_author(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- field_activities
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS field_activities_select_restrict ON public.field_activities;
CREATE POLICY field_activities_select_restrict ON public.field_activities
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.caller_sees_all_activity(business_id)
    OR (staff_id IS NOT NULL AND staff_id = public.caller_staff_id(business_id))
    OR public.is_activity_viewer(id)
  );

-- Writes are attributed to the caller: a rep cannot log as someone else, and an owner (no staff
-- row) logs with staff_id NULL.
DROP POLICY IF EXISTS field_activities_insert_restrict ON public.field_activities;
CREATE POLICY field_activities_insert_restrict ON public.field_activities
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(business_id)
  );

-- Activities are records: no member edits or removes them.
DROP POLICY IF EXISTS field_activities_update_restrict ON public.field_activities;
CREATE POLICY field_activities_update_restrict ON public.field_activities
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
DROP POLICY IF EXISTS field_activities_delete_restrict ON public.field_activities;
CREATE POLICY field_activities_delete_restrict ON public.field_activities
  AS RESTRICTIVE FOR DELETE TO authenticated USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- activity_viewers: only the author or a see-all person decides who is tagged.
-- (Reading follows the parent activity through the existing policy.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS activity_viewers_insert_restrict ON public.activity_viewers;
CREATE POLICY activity_viewers_insert_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.caller_sees_all_activity(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id)))
  );
DROP POLICY IF EXISTS activity_viewers_modify_restrict ON public.activity_viewers;
CREATE POLICY activity_viewers_modify_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    public.caller_sees_all_activity(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id))));
DROP POLICY IF EXISTS activity_viewers_delete_restrict ON public.activity_viewers;
CREATE POLICY activity_viewers_delete_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    public.caller_sees_all_activity(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id))));

-- ---------------------------------------------------------------------------
-- reactions and comments: attributed to the caller; removable by their author or a see-all person.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS activity_reactions_insert_restrict ON public.activity_reactions;
CREATE POLICY activity_reactions_insert_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_reactions_modify_restrict ON public.activity_reactions;
CREATE POLICY activity_reactions_modify_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_reactions_delete_restrict ON public.activity_reactions;
CREATE POLICY activity_reactions_delete_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));

DROP POLICY IF EXISTS activity_comments_insert_restrict ON public.activity_comments;
CREATE POLICY activity_comments_insert_restrict ON public.activity_comments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_comments_modify_restrict ON public.activity_comments;
CREATE POLICY activity_comments_modify_restrict ON public.activity_comments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_comments_delete_restrict ON public.activity_comments;
CREATE POLICY activity_comments_delete_restrict ON public.activity_comments
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.caller_sees_all_activity(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
