-- ============================================================================
-- ADR Reporting Module - Phase 2, Item 4: Per-user report visibility + RLS
--
-- Status: DRAFT — apply via MCP after review.
--
-- Replaces the flat "any member of the business sees every report" policy with
-- role-aware visibility:
--   - Platform admin ......................... sees everything
--   - Owner (businesses.email match) ......... sees every report of their business
--   - Staff with role 'Manager'/'Owner' ...... sees every report of their business
--   - Every other active staff member ........ sees ONLY reports they created
--     (created_by_user_id = their staff.id)  -> the spec's "individual
--     reporters see their own reports" requirement
--
-- Child tables (products / meds / reactions / photos) have no business_id; they
-- derive tenancy through the parent report. They now scope through the same
-- can_access_adr_report(report_id) helper so a reporter's child rows are only
-- visible with the parent report they own — closing the gap where a reporter
-- could previously read ANY business report's child rows.
--
-- SECURITY INVOKER note: can_access_adr_report is SECURITY DEFINER (like
-- current_business_ids()) so policy subqueries against staff/businesses do not
-- recurse into RLS. search_path pinned to public on both the function and the
-- policies.
--
-- Existing rows: every live report has created_by_user_id = NULL (created
-- before this feature). They remain visible to owners/managers/admins; a
-- reporter cannot "inherit" a pre-existing draft. Documented in CODE_AUDIT.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. can_access_adr_report - single source of truth for report visibility
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_adr_report(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM adr_reports r
    WHERE r.report_id = p_report_id
      AND (
        -- Platform admin sees everything.
        is_platform_admin()
        -- The business owner (email matches the businesses row).
        OR r.business_id IN (SELECT id FROM businesses WHERE lower(email) = lower(auth.email()))
        -- Staff with Manager/Owner role see all of their business's reports.
        OR r.business_id IN (
          SELECT s.business_id FROM staff s
          WHERE s.status = 'active'
            AND lower(s.email) = lower(auth.email())
            AND s.role IN ('Manager', 'Owner')
        )
        -- Any other active staff member sees only the reports they created.
        OR (
          r.created_by_user_id IS NOT NULL
          AND r.created_by_user_id IN (
            SELECT s.id FROM staff s
            WHERE s.status = 'active'
              AND (s.auth_user_id = auth.uid() OR lower(s.email) = lower(auth.email()))
          )
        )
      )
  )
$$;

COMMENT ON FUNCTION public.can_access_adr_report(uuid) IS
  'Role-aware ADR report visibility (Phase 2 Item 4). SECURITY DEFINER so RLS on staff/businesses/adr_reports does not recurse; search_path pinned.';

-- ----------------------------------------------------------------------------
-- 2. adr_reports - replace the flat business-isolation policy
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_reports business isolation" ON adr_reports;

CREATE POLICY "adr_reports select" ON adr_reports
  FOR SELECT
  USING (public.can_access_adr_report(report_id));

-- INSERT only needs tenant + platform-admin: a brand-new report has no
-- created_by_user_id yet to match, and the report row cannot exist before the
-- insert. The client sets business_id and (for staff) created_by_user_id.
CREATE POLICY "adr_reports insert" ON adr_reports
  FOR INSERT
  WITH CHECK (
    business_id IN (SELECT public.current_business_ids())
    OR is_platform_admin()
  );

CREATE POLICY "adr_reports update" ON adr_reports
  FOR UPDATE
  USING (public.can_access_adr_report(report_id))
  WITH CHECK (public.can_access_adr_report(report_id));

CREATE POLICY "adr_reports delete" ON adr_reports
  FOR DELETE
  USING (public.can_access_adr_report(report_id));

-- ----------------------------------------------------------------------------
-- 3. Child tables - scope through the parent report's visibility
--    (this also lets a reporter see the child rows of their OWN report, and
--    closes the previous read-everything gap)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_report_products business isolation" ON adr_report_products;
DROP POLICY IF EXISTS "adr_report_concomitant_meds business isolation" ON adr_report_concomitant_meds;
DROP POLICY IF EXISTS "adr_report_reactions business isolation" ON adr_report_reactions;
DROP POLICY IF EXISTS "adr_report_evidence_photos business isolation" ON adr_report_evidence_photos;

CREATE POLICY "adr_report_products via report" ON adr_report_products
  FOR ALL
  USING (public.can_access_adr_report(report_id))
  WITH CHECK (public.can_access_adr_report(report_id));

CREATE POLICY "adr_report_concomitant_meds via report" ON adr_report_concomitant_meds
  FOR ALL
  USING (public.can_access_adr_report(report_id))
  WITH CHECK (public.can_access_adr_report(report_id));

CREATE POLICY "adr_report_reactions via report" ON adr_report_reactions
  FOR ALL
  USING (public.can_access_adr_report(report_id))
  WITH CHECK (public.can_access_adr_report(report_id));

CREATE POLICY "adr_report_evidence_photos via report" ON adr_report_evidence_photos
  FOR ALL
  USING (public.can_access_adr_report(report_id))
  WITH CHECK (public.can_access_adr_report(report_id));

-- ----------------------------------------------------------------------------
-- 4. Restrict EXECUTE on the helper (applied as a follow-up migration
--    `adr_phase2_restrict_function_execute`): REVOKE FROM anon alone is
--    ineffective because PUBLIC holds EXECUTE. Revoke PUBLIC and re-grant to
--    authenticated (the role RLS policies and the client call this as).
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.can_access_adr_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_adr_report(uuid) TO authenticated;
