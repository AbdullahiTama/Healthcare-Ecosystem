-- carehub_20270115_purchase_export_audit
--
-- Status: NOT APPLIED. Needs the owner's approval to apply to production (szdybxmgmhndoytqanfb).
-- Docs: docs/architecture/Purchases-Import-Export.md
--
-- PROBLEM
-- -------
-- Purchases can now be exported to Excel or CSV (one row per purchase line, with unit costs, totals and balances).
-- Every export of cost data is recorded in audit_log through record_export_audit(), which is also where the database
-- decides who may export (the Owner, or a role whose permissions carry canExportReports). Its allow-list only knows
-- 'inventory.xlsx' and 'sales_report.xlsx', so a purchases export is refused as "Unknown export type" before the
-- permission check and before anything is recorded.
--
-- FIX
-- ---
-- Same function and signature (no sibling overload), read verbatim from the live database on 2026-11-11 (it matched
-- carehub_20261210_pos_accounting section 13 exactly). Two changes only:
--   1. the allow-list gains 'purchases.xlsx' and 'purchases.csv';
--   2. includes_cost_data is true for them (purchase exports carry unit costs), as for inventory.xlsx.
--
-- SECURITY IMPLICATIONS
-- ---------------------
--   * No one gains access to data: purchases (with their costs) are already readable by members of the business
--     through get_purchases_page and the purchases table. This only lets a purchases export be recorded.
--   * Who may export is unchanged: Owner, or a custom role with canExportReports. Anyone else is refused (42501) and
--     the app then saves no file.
--   * SECURITY DEFINER, pinned search_path, EXECUTE for authenticated only (grants restated below).
--
-- BEFORE IT IS APPLIED
-- --------------------
-- The app offers Export only to the Owner and roles with "Export reports". The audit call fails with "Unknown export
-- type" (reported by the app as "failed", not "refused"), so the file is still saved and the user is told the audit
-- record could not be saved, exactly as for any other audit failure.
--
-- ROLLBACK
-- --------
-- Re-run section 13 of carehub_20261210_pos_accounting.sql (the previous definition).
--
-- VERIFY AFTER APPLYING
-- ---------------------
--   select position('purchases.csv' in pg_get_functiondef('public.record_export_audit(uuid,text,integer,jsonb)'::regprocedure)) > 0;
--   select proacl from pg_proc where proname = 'record_export_audit';   -- authenticated only; no anon, no PUBLIC
-- Rolled-back probe: as an Owner, select record_export_audit(<business>, 'purchases.csv', 3, '{}') returns an id
-- with metadata.includes_cost_data = true; as a Cashier without canExportReports it raises 42501; an unknown type
-- ('purchases.pdf') still raises 22023.

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
  IF p_export_type IS NULL OR p_export_type NOT IN ('inventory.xlsx', 'sales_report.xlsx', 'purchases.xlsx', 'purchases.csv') THEN
    RAISE EXCEPTION 'Unknown export type' USING ERRCODE = '22023';
  END IF;
  IF p_row_count IS NULL OR p_row_count < 0 THEN
    RAISE EXCEPTION 'row count must be zero or more' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_filters) <> 'object' OR pg_column_size(v_filters) > 2000 THEN
    RAISE EXCEPTION 'filters must be a small JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT s.id, s.role INTO v_staff_id, v_staff_role
    FROM public.staff s
   WHERE s.business_id = p_business_id AND lower(s.email) = v_email AND s.status = 'active'
   LIMIT 1;

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
      'includes_cost_data', p_export_type IN ('inventory.xlsx', 'purchases.xlsx', 'purchases.csv'),
      'actor_email', v_email,
      'staff_id', v_staff_id,
      'staff_role', v_staff_role)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_export_audit(uuid, text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_export_audit(uuid, text, integer, jsonb) TO authenticated;
