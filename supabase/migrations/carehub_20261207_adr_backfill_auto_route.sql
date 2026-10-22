-- ============================================================================
-- ADR routing: one-off backfill for reports submitted before auto-routing.
--
-- Status: DRAFT, NOT APPLIED. Apply only with explicit owner approval, and only
-- AFTER 20261206_adr_auto_route_verified_selections.sql.
--
-- Routes the existing submitted public reports whose route is still pending, was
-- selected by the reporter from the registry (selection_kind='verified'), is not
-- on hold, and whose company is still eligible. Uses the same helper, so each
-- route gets the same audit event (actor 'system', auto:true) and the same
-- company alert. Idempotent: only status='pending' rows change, so a re-run is a
-- no-op. Typed / unknown / held / now-ineligible routes are left for reviewers.
--
-- Effect to expect: each responsible company's owner and tracker-enabled staff
-- receive one "New safety case routed to your organisation" alert PER ROUTED
-- REPORT, including reports that are days old. The regulatory submission
-- deadline on each report has been running since submission and is unchanged.
-- ============================================================================
SELECT a.report_number, public.adr_auto_route_report(a.report_id) AS result
  FROM adr_reports a
 WHERE a.report_source = 'public'
   AND a.status <> 'draft'
   AND a.gate_validated_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM adr_product_company_routes r
                WHERE r.report_id = a.report_id
                  AND r.status = 'pending'
                  AND r.selection_kind = 'verified'
                  AND r.held_at IS NULL)
 ORDER BY a.created_at;
