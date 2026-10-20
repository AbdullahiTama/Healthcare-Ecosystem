-- APPLIED TO PRODUCTION 2026-10-20 as carehub_20261020_default_viewers_own_rows (version 20261020154020). Verified by reading the catalog back and by a
-- rolled-back behavioural run against the live policies. The applied copy carries a shorter header comment;
-- the statements are identical.
-- Audit finding F7 (docs/audits/live-field-activity-audit.md).
--
-- WHAT IS WRONG TODAY (confirmed on the live project, 2026-10-20)
--   activity_default_viewers has ONE policy: "activity_default_viewers of own business", PERMISSIVE,
--   FOR ALL, role public, business_id IN current_business_ids() OR is_platform_admin(). So any member of
--   a company can replace any colleague's default-viewer list (the app passes the staff id from the
--   client). The next report that colleague logs is tagged to whoever the attacker chose, and a tagged
--   viewer can read that report (is_activity_viewer). The table is empty today, so nothing is exposed yet.
--
-- WHAT THIS CHANGES
--   A member may write only their OWN list: rows whose staff_id is the caller's staff id in that business
--   (or a platform admin). Reading is unchanged. The app already writes only the caller's own rows, so
--   there is no client change and it can be applied on its own, before or after any other draft.
--
-- METHOD
--   RESTRICTIVE policies, ANDed with the existing permissive one, TO authenticated. Nothing is dropped by
--   name (a DROP POLICY IF EXISTS on a wrong name is a silent no-op). The helper caller_staff_id() already
--   exists and is executable by authenticated (carehub_20261131_field_activity_access.sql).
--   Not added: a check that viewer_staff_id belongs to the same company. A viewer from another company
--   can read nothing, because is_activity_viewer() also requires the viewer to be a member of the
--   activity's company, and the policy would need to read staff, whose own policies were not re-verified.
--
-- Rollback: DROP POLICY <name> ON public.activity_default_viewers for each of the three below.

DROP POLICY IF EXISTS activity_default_viewers_insert_restrict ON public.activity_default_viewers;
CREATE POLICY activity_default_viewers_insert_restrict ON public.activity_default_viewers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (staff_id IS NOT NULL AND staff_id = public.caller_staff_id(business_id))
  );

DROP POLICY IF EXISTS activity_default_viewers_update_restrict ON public.activity_default_viewers;
CREATE POLICY activity_default_viewers_update_restrict ON public.activity_default_viewers
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (staff_id IS NOT NULL AND staff_id = public.caller_staff_id(business_id))
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (staff_id IS NOT NULL AND staff_id = public.caller_staff_id(business_id))
  );

DROP POLICY IF EXISTS activity_default_viewers_delete_restrict ON public.activity_default_viewers;
CREATE POLICY activity_default_viewers_delete_restrict ON public.activity_default_viewers
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (staff_id IS NOT NULL AND staff_id = public.caller_staff_id(business_id))
  );

-- A completed statement is not evidence it did anything: fail loudly if the policies are not there.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'activity_default_viewers'
         AND policyname LIKE 'activity_default_viewers_%_restrict' AND permissive = 'RESTRICTIVE') <> 3 THEN
    RAISE EXCEPTION 'activity_default_viewers: expected 3 restrictive write policies';
  END IF;
END $$;
