-- ============================================================================
-- ADR Reporting Module - Phase 2, Item 3: Reports/analytics view
--
-- Status: APPLIED via MCP (migration `adr_phase2_reports_analytics`). This
-- file is the source-of-record copy for the repository — it mirrors the
-- applied view exactly (verified against pg_get_viewdef).
--
-- Aggregates the seriousness flag across each report's reactions so the
-- analytics tab can count serious vs non-serious reports without N+1 queries.
--
-- SECURITY: the view MUST be security_invoker. A default (security_definer)
-- view owned by postgres would bypass RLS on adr_reports/adr_report_reactions
-- and leak every business's ADR data to any authenticated caller.
-- ============================================================================

CREATE OR REPLACE VIEW public.adr_report_analytics
WITH (security_invoker = true) AS
SELECT
  r.report_id,
  r.report_number,
  r.business_id,
  r.module_type,
  r.status,
  r.created_at,
  r.submission_deadline,
  r.reaction_expected,
  r.new_safety_signal,
  COALESCE(bool_or(
    x.seriousness_death OR x.seriousness_life_threatening OR x.seriousness_hospitalization
    OR x.seriousness_disability OR x.seriousness_congenital_anomaly OR x.seriousness_other_medically_important
  ), false) AS is_serious
FROM adr_reports r
LEFT JOIN adr_report_reactions x ON x.report_id = r.report_id
GROUP BY r.report_id;

COMMENT ON VIEW public.adr_report_analytics IS
  'ADR analytics projection (Phase 2 Item 3). SECURITY INVOKER so RLS scopes rows to the caller. is_serious is bool_or over each report''s reaction seriousness flags.';