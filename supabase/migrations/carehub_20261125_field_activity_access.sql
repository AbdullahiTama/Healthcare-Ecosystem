-- Field activity access hardening (Phase 7, baseline findings S3-S5).
-- PREPARED, NOT APPLIED. Tested on PGlite (scripts/db-tests/activity.pglite.mjs)
-- against the permissive policies from sql/phase2_rls_pilot.sql. THE LIVE POLICIES
-- MAY DIFFER; check pg_policies on field_activities, activity_viewers,
-- activity_reactions and activity_comments before applying.
--
-- THIS CHANGES BEHAVIOUR, so it needs an explicit product decision:
--   Before: any member of a company can read every colleague's activity (including
--           GPS), log or react as another person, and edit or delete any activity.
--   After:  a person sees an activity only if they wrote it, were tagged as a
--           viewer, or are a manager/owner of the business (or platform admin);
--           writes are attributed to the caller; activities cannot be edited or
--           deleted by members (the app never does, and they are kept as records).
--
-- Method: RESTRICTIVE policies. A restrictive policy is ANDed with whatever
-- permissive policies exist, so this works without dropping policies by name
-- (a DROP POLICY IF EXISTS on a wrong name is a silent no-op).
--
-- Known consequences, by design or to be decided:
--  * Realtime evaluates RLS when a row is inserted. activity_viewers rows are
--    written just AFTER the activity, so a tagged non-manager sees the activity on
--    their next load, not as a live push. Managers/owners are unaffected.
--  * actor_name on reactions/comments is still client-supplied (display only).
--  * Platform admins keep full access.
--
-- Rollback: DROP POLICY ... for each *_restrict policy below; DROP FUNCTION the helpers.

-- The caller's staff id in a business; NULL for the owner or a non-member.
CREATE OR REPLACE FUNCTION public.caller_staff_id(bid uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id FROM public.staff s
   WHERE s.business_id = bid AND lower(s.email) = lower(auth.email()) AND s.status = 'active'
   LIMIT 1
$$;

-- True when the caller was tagged as a viewer of the activity. SECURITY DEFINER so
-- the field_activities policy can ask about activity_viewers without the two
-- tables' policies recursing into each other.
CREATE OR REPLACE FUNCTION public.is_activity_viewer(aid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.activity_viewers v
    JOIN public.field_activities a ON a.id = v.activity_id
    WHERE v.activity_id = aid AND v.staff_id = public.caller_staff_id(a.business_id)
      AND public.caller_staff_id(a.business_id) IS NOT NULL)
$$;

-- Business and author of an activity, readable regardless of the caller's own RLS.
CREATE OR REPLACE FUNCTION public.activity_business(aid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT business_id FROM public.field_activities WHERE id = aid $$;

CREATE OR REPLACE FUNCTION public.activity_author(aid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT staff_id FROM public.field_activities WHERE id = aid $$;

REVOKE ALL ON FUNCTION public.caller_staff_id(uuid), public.is_activity_viewer(uuid),
  public.activity_business(uuid), public.activity_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_staff_id(uuid), public.is_activity_viewer(uuid),
  public.activity_business(uuid), public.activity_author(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- field_activities
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS field_activities_select_restrict ON public.field_activities;
CREATE POLICY field_activities_select_restrict ON public.field_activities
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR public.is_business_manager(business_id)
    OR (staff_id IS NOT NULL AND staff_id = public.caller_staff_id(business_id))
    OR public.is_activity_viewer(id)
  );

-- Writes are attributed to the caller: a rep cannot log as someone else, and an
-- owner (no staff row) logs with staff_id NULL.
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
-- activity_viewers: only the author or a manager decides who is tagged.
-- (Reading follows the parent activity through the existing policy.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS activity_viewers_insert_restrict ON public.activity_viewers;
CREATE POLICY activity_viewers_insert_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR public.is_business_manager(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id)))
  );
DROP POLICY IF EXISTS activity_viewers_modify_restrict ON public.activity_viewers;
CREATE POLICY activity_viewers_modify_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR public.is_business_manager(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id))));
DROP POLICY IF EXISTS activity_viewers_delete_restrict ON public.activity_viewers;
CREATE POLICY activity_viewers_delete_restrict ON public.activity_viewers
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR public.is_business_manager(public.activity_business(activity_id))
    OR (public.activity_author(activity_id) IS NOT NULL
        AND public.activity_author(activity_id) = public.caller_staff_id(public.activity_business(activity_id))));

-- ---------------------------------------------------------------------------
-- reactions and comments: attributed to the caller; removable by their author,
-- a manager, or a platform admin.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS activity_reactions_insert_restrict ON public.activity_reactions;
CREATE POLICY activity_reactions_insert_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_reactions_modify_restrict ON public.activity_reactions;
CREATE POLICY activity_reactions_modify_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR public.is_business_manager(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_reactions_delete_restrict ON public.activity_reactions;
CREATE POLICY activity_reactions_delete_restrict ON public.activity_reactions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_platform_admin() OR public.is_business_manager(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));

DROP POLICY IF EXISTS activity_comments_insert_restrict ON public.activity_comments;
CREATE POLICY activity_comments_insert_restrict ON public.activity_comments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin()
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_comments_modify_restrict ON public.activity_comments;
CREATE POLICY activity_comments_modify_restrict ON public.activity_comments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR public.is_business_manager(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
DROP POLICY IF EXISTS activity_comments_delete_restrict ON public.activity_comments;
CREATE POLICY activity_comments_delete_restrict ON public.activity_comments
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_platform_admin() OR public.is_business_manager(public.activity_business(activity_id))
    OR staff_id IS NOT DISTINCT FROM public.caller_staff_id(public.activity_business(activity_id)));
