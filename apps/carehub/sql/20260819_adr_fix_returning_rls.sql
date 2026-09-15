-- ============================================================================
-- ADR Reporting Module - fix: INSERT ... RETURNING always 403 (42501) via RLS
--
-- Status: APPLIED 2026-08-19 via MCP (migration `adr_fix_returning_rls`).
--
-- Symptom: POST /rest/v1/adr_reports from the app returned 403 for every
-- authenticated caller, including the business owner. Postgres logged
-- `42501: new row violates row-level security policy for table "adr_reports"`.
--
-- Root cause (verified live by impersonating roles + evaluating policies):
-- PostgREST always wraps INSERT with `RETURNING *`. With RLS enabled,
-- PostgreSQL applies the table's SELECT policy to the rows RETURNING produces,
-- in addition to the INSERT policy's WITH CHECK. The old SELECT policy called
--   can_access_adr_report(report_id),
-- which reads `adr_reports` back to decide access. During `INSERT ... RETURNING`
-- that internal read uses the command snapshot taken BEFORE the new row is
-- inserted, so the just-inserted row is invisible to it -> the policy always
-- evaluates false -> 42501 for everyone, owners included. (The INSERT WITH
-- CHECK itself was fine: `business_id IN current_business_ids()` passed.)
-- Disabling every trigger did not change it; `INSERT ... RETURNING` failed,
-- plain `INSERT` succeeded. The policy chain was the only gate.
--
-- Fix: visibility for `adr_reports` rows must be computed from the row's OWN
-- columns (business_id, created_by_user_id), never by re-reading the same
-- table to find that row. Introduces
--   can_access_adr_report_row(p_business_id, p_created_by_user_id)
-- as the single source of truth for "who may see this report", holding the
-- exact Item 4 rules (platform admin -> all; business owner by email match and
-- staff with Manager/Owner role -> all of their business; every other active
-- staff member -> only reports they created). The report_id-based helper
--   can_access_adr_report(p_report_id)
-- now delegates to the row helper, so `adr_reports` SELECT/UPDATE/DELETE go
-- through the row helper directly, while the child tables and
-- adr_report_events keep the report_id helper (their parent report always
-- exists before any child/event row, so no self-reference problem there).
--
-- Security posture unchanged and re-verified: per-user visibility preserved
-- (a non-owner staff member still sees only reports they created), cross-tenant
-- INSERT still blocked by the unchanged tenant WITH CHECK, cross-tenant rows
-- still invisible, platform admin still sees everything, anon still gets no
-- SELECT (EXECUTE on the new helper revoked from PUBLIC + anon).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. can_access_adr_report_row - row-based visibility (no self-referencing read)
--    SECURITY DEFINER like the other helpers so policy subqueries against
--    staff/businesses do not recurse into RLS; search_path pinned to public.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_adr_report_row(p_business_id uuid, p_created_by_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_platform_admin()
    OR p_business_id IN (SELECT id FROM businesses WHERE lower(email) = lower(auth.email()))
    OR p_business_id IN (
         SELECT s.business_id FROM staff s
         WHERE s.status = 'active'
           AND lower(s.email) = lower(auth.email())
           AND s.role IN ('Manager', 'Owner')
       )
    OR (
         p_created_by_user_id IS NOT NULL
         AND p_created_by_user_id IN (
           SELECT s.id FROM staff s
           WHERE s.status = 'active'
             AND (s.auth_user_id = auth.uid() OR lower(s.email) = lower(auth.email()))
         )
       )
$$;

COMMENT ON FUNCTION public.can_access_adr_report_row(uuid, uuid) IS
  'Role-aware ADR report visibility computed from the report row''s own columns. Single source of truth; can_access_adr_report(uuid) delegates to it. Row-based so INSERT ... RETURNING (PostgREST''s default) is not re-checked against a read of the very row being inserted.';

-- ----------------------------------------------------------------------------
-- 2. can_access_adr_report - report_id variant now delegates to the row helper
--    Used by the child tables (products/meds/reactions/photos) and events,
--    whose parent report row always exists before they do.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_adr_report(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM adr_reports r
    WHERE r.report_id = p_report_id
      AND public.can_access_adr_report_row(r.business_id, r.created_by_user_id)
  )
$$;

COMMENT ON FUNCTION public.can_access_adr_report(uuid) IS
  'Role-aware ADR report visibility (Phase 2 Item 4). Delegates to can_access_adr_report_row; SECURITY DEFINER so RLS on staff/businesses/adr_reports does not recurse; search_path pinned.';

-- ----------------------------------------------------------------------------
-- 3. adr_reports - SELECT/UPDATE/DELETE policies use the row-based helper so
--    INSERT ... RETURNING (and any UPDATE/DELETE ... RETURNING) re-check the
--    row itself instead of an invisible self-read.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "adr_reports select" ON adr_reports;
DROP POLICY IF EXISTS "adr_reports update" ON adr_reports;
DROP POLICY IF EXISTS "adr_reports delete" ON adr_reports;

CREATE POLICY "adr_reports select" ON adr_reports
  FOR SELECT
  USING (public.can_access_adr_report_row(business_id, created_by_user_id));

CREATE POLICY "adr_reports update" ON adr_reports
  FOR UPDATE
  USING (public.can_access_adr_report_row(business_id, created_by_user_id))
  WITH CHECK (public.can_access_adr_report_row(business_id, created_by_user_id));

CREATE POLICY "adr_reports delete" ON adr_reports
  FOR DELETE
  USING (public.can_access_adr_report_row(business_id, created_by_user_id));

-- The INSERT policy is unchanged: tenant + platform-admin WITH CHECK (a brand-
-- new row has no created_by_user_id to match yet, and the client sets
-- business_id). It is not self-referencing, so it never had the bug.

-- ----------------------------------------------------------------------------
-- 4. Restrict EXECUTE on the new helper (same hardening as the other helpers):
--    REVOKE FROM anon alone is ineffective because PUBLIC holds EXECUTE —
--    revoke PUBLIC and re-grant to authenticated (the role RLS policies and
--    the client call this as).
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.can_access_adr_report_row(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_adr_report_row(uuid, uuid) TO authenticated;

-- can_access_adr_report(uuid) already carries the same restriction from
-- `adr_phase2_restrict_function_execute`; the CREATE OR REPLACE above does not
-- reset its ACL.