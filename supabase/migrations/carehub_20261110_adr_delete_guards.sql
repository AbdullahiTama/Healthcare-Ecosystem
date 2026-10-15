-- ============================================================================
-- ADR Reporting Module - Phase 9: delete guards + submit EXECUTE hardening
--                        + deadline-rule change audit
--
-- Status: REVIEW ONLY — do NOT apply to production without PV/regulatory
--         and privacy sign-off (see master prompt §14).
--
-- Closes three hardening gaps found by live adversarial probes:
--   1. Submitted cases (and their children) were hard-deletable by the
--      owning business as an ordinary edit. Now: non-admin hard delete of a
--      non-draft report, of children of a non-draft report, or of a
--      verified/routed route raises. Admin break-glass stays platform-audited.
--   2. submit_adr_report / submit_adr_public_report carried default PUBLIC
--      EXECUTE (rewrites preserved the pre-hardening ACL). Now
--      authenticated-only like every other ADR RPC. (Outcome was already
--      safe — RLS/helper denial — this removes the surface.)
--   3. Deadline-rule changes had no audit row. Now every insert/update/delete
--      on adr_deadline_rules writes admin_audit_log with before/after.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Case hard-delete guards (non-admin, non-draft)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_guard_case_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'draft' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'submitted cases cannot be deleted; use the approved archive/retention handling';
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_guard_case_delete ON adr_reports;
CREATE TRIGGER trg_adr_guard_case_delete
  BEFORE DELETE ON adr_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_guard_case_delete();

COMMENT ON FUNCTION public.adr_guard_case_delete() IS
  'Blocks non-admin hard deletes of non-draft ADR reports. Draft owners keep delete; submitted cases use retention handling.';

-- One guard for all four child tables: deletable only while the parent is a
-- draft (or by platform admin). All four carry report_id.
CREATE OR REPLACE FUNCTION public.adr_guard_child_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM adr_reports WHERE report_id = OLD.report_id;
  IF FOUND AND v_status IS DISTINCT FROM 'draft' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'rows of submitted cases cannot be deleted; record a versioned follow-up instead';
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_guard_child_delete ON adr_report_products;
CREATE TRIGGER trg_adr_guard_child_delete
  BEFORE DELETE ON adr_report_products
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_guard_child_delete();

DROP TRIGGER IF EXISTS trg_adr_guard_child_delete ON adr_report_concomitant_meds;
CREATE TRIGGER trg_adr_guard_child_delete
  BEFORE DELETE ON adr_report_concomitant_meds
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_guard_child_delete();

DROP TRIGGER IF EXISTS trg_adr_guard_child_delete ON adr_report_reactions;
CREATE TRIGGER trg_adr_guard_child_delete
  BEFORE DELETE ON adr_report_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_guard_child_delete();

DROP TRIGGER IF EXISTS trg_adr_guard_child_delete ON adr_report_evidence_photos;
CREATE TRIGGER trg_adr_guard_child_delete
  BEFORE DELETE ON adr_report_evidence_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_guard_child_delete();

COMMENT ON FUNCTION public.adr_guard_child_delete() IS
  'Blocks non-admin deletes of child rows belonging to non-draft reports.';

-- Verified/routed routes are load-bearing access grants: submitters cannot
-- remove them (would silently revoke a company investigation); admin only.
CREATE OR REPLACE FUNCTION public.adr_guard_route_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('verified', 'routed') AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'verified routes cannot be deleted except by platform admin';
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_guard_route_delete ON adr_product_company_routes;
CREATE TRIGGER trg_adr_guard_route_delete
  BEFORE DELETE ON adr_product_company_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_guard_route_delete();

COMMENT ON FUNCTION public.adr_guard_route_delete() IS
  'Blocks non-admin deletes of verified/routed product-company routes.';

-- ----------------------------------------------------------------------------
-- 2. Submit RPC EXECUTE hardening (authenticated-only, like all other RPCs)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.submit_adr_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_adr_report(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_adr_public_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_adr_public_report(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adr_guard_case_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_guard_case_delete() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adr_guard_child_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_guard_child_delete() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adr_guard_route_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_guard_route_delete() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Deadline-rule change audit (admin_audit_log, before/after)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adr_audit_deadline_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_audit_log (actor_admin_id, action, target_table, target_id, before, after)
  VALUES (
    auth.uid(),
    TG_OP || ' adr_deadline_rules',
    'adr_deadline_rules',
    coalesce(NEW.rule_version, OLD.rule_version),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_adr_audit_deadline_rule ON adr_deadline_rules;
CREATE TRIGGER trg_adr_audit_deadline_rule
  AFTER INSERT OR UPDATE OR DELETE ON adr_deadline_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_audit_deadline_rule();

COMMENT ON FUNCTION public.adr_audit_deadline_rule() IS
  'Audits every deadline-rule insert/update/delete with actor and before/after into admin_audit_log.';

REVOKE EXECUTE ON FUNCTION public.adr_audit_deadline_rule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_audit_deadline_rule() TO authenticated;
