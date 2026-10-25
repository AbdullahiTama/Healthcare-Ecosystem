-- Export audit trail: who exported what, when, from which business.
--
-- Status: NOT YET APPLIED. Written against the LIVE schema read on 2026-10-25:
--   * public.audit_log exists (0 rows, RLS on) with the shape from carehub_20260810_audit_log.sql, but
--     anon AND authenticated hold INSERT/UPDATE/DELETE/TRUNCATE on it. RLS blocks row writes today
--     (insert is platform-admin only, no update/delete policy), TRUNCATE is not covered by RLS.
--   * public.export_logs is a different thing (platform-admin exports: reason + watermark). Not reused.
--   * No export-audit function exists.
--
-- WHAT THIS DOES
--   1. Hardens audit_log: client roles keep SELECT only (the existing tenant-visibility policy still
--      decides which rows), and a trigger makes it append-only, as staff_checkins already is.
--   2. Adds record_export_audit(p_business_id, p_export_type, p_row_count, p_filters): the ONLY write
--      path from the app. SECURITY DEFINER so the table needs no client INSERT grant, and it decides
--      everything that matters itself:
--        * actor is auth.uid() / auth.email(); a client cannot name another actor
--        * the caller must be the business owner, an owner of an ANCESTOR business (an owner working
--          inside a branch), or an ACTIVE staff member of that business
--        * the caller must hold the export permission, mirroring apps/carehub/src/lib/permissions.js
--          getPerms(): 'Owner' always; otherwise the business's own `roles` row for the staff member's
--          role must have permissions.canExportReports = true. Built-in presets other than Owner never
--          export. A request from someone who may not export is refused (42501) and writes nothing.
--        * p_export_type is an allow-list, row count and filters are bounded, so the log cannot be
--          used as a free-text dumping ground.
--
-- WHAT IT DOES NOT DO
--   It cannot stop a signed-in user from copying data the browser already holds; it records that an
--   export was declared. The app calls it before building the file. Docs: docs/architecture/Inventory-Export.md
--
-- Depends on: audit_log, businesses(email, parent_business_id), staff, roles(business_id, name, permissions).
-- Rollback: DROP FUNCTION public.record_export_audit(uuid, text, integer, jsonb);
--           DROP TRIGGER audit_log_append_only ON public.audit_log; DROP TRIGGER audit_log_no_truncate ON public.audit_log;
--           DROP FUNCTION public.audit_log_append_only();
--           GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_log TO authenticated;  -- only if the old grants are wanted back

-- ---------------------------------------------------------------------------
-- 1. Harden audit_log
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.audit_log_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- 2. record_export_audit: the only write path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_export_audit(
  p_business_id uuid,
  p_export_type text,
  p_row_count integer,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(auth.email());
  v_staff_id uuid;
  v_staff_role text;
  v_owner boolean;
  v_allowed boolean;
  v_perms jsonb;
  v_filters jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'business id is required' USING ERRCODE = '22023';
  END IF;
  IF p_export_type IS NULL OR p_export_type NOT IN ('inventory.xlsx') THEN
    RAISE EXCEPTION 'Unknown export type' USING ERRCODE = '22023';
  END IF;
  IF p_row_count IS NULL OR p_row_count < 0 THEN
    RAISE EXCEPTION 'row count must be zero or more' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_filters) <> 'object' OR pg_column_size(v_filters) > 2000 THEN
    RAISE EXCEPTION 'filters must be a small JSON object' USING ERRCODE = '22023';
  END IF;

  -- Who is this, for this business? Decided here from the caller's own identity.
  SELECT s.id, s.role INTO v_staff_id, v_staff_role
    FROM public.staff s
   WHERE s.business_id = p_business_id AND lower(s.email) = v_email AND s.status = 'active'
   LIMIT 1;

  -- Owner of this business, or of any ancestor (an owner working inside a branch). The walk
  -- uses UNION so a malformed parent cycle terminates; depth is capped at 10 as well.
  WITH RECURSIVE up(id, parent_business_id, depth) AS (
    SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
    UNION
    SELECT p.id, p.parent_business_id, up.depth + 1
      FROM public.businesses p JOIN up ON p.id = up.parent_business_id
     WHERE up.depth < 10
  )
  SELECT EXISTS (
    SELECT 1 FROM up JOIN public.businesses o ON o.id = up.id WHERE lower(o.email) = v_email
  ) INTO v_owner;

  IF NOT v_owner AND v_staff_id IS NULL THEN
    RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501';
  END IF;

  -- Export permission, mirroring getPerms(): Owner always; a custom role's own flag otherwise.
  IF v_owner OR v_staff_role = 'Owner' THEN
    v_allowed := true;
  ELSE
    SELECT r.permissions INTO v_perms
      FROM public.roles r
     WHERE r.business_id = p_business_id AND r.name = v_staff_role
     LIMIT 1;
    v_allowed := COALESCE(v_perms -> 'canExportReports' = 'true'::jsonb, false);
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Your role is not allowed to export data' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, branch_id, action, target_type, metadata)
  VALUES (
    v_uid,
    CASE WHEN v_owner THEN 'owner' ELSE 'staff' END,
    p_business_id,
    'export.created',
    split_part(p_export_type, '.', 1),
    jsonb_build_object(
      'export_type', p_export_type,
      'row_count', p_row_count,
      'filters', v_filters,
      'includes_cost_data', true,
      'actor_email', v_email,
      'staff_id', v_staff_id,
      'staff_role', v_staff_role)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_export_audit(uuid, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_export_audit(uuid, text, integer, jsonb) TO authenticated;

COMMENT ON FUNCTION public.record_export_audit(uuid, text, integer, jsonb) IS
  'Records a data export in audit_log. Actor from the JWT; caller must be an owner/active staff member with export permission. Only write path to audit_log.';
