# ADR PV Analytics (Phase 6)

## What changed

The Tracker gains an analytics section built exclusively from the company's
authorized routed cases. The Hub analytics tab is untouched.

- `supabase/migrations/carehub_20261107_adr_analytics_access.sql`
  (mirror: `apps/carehub/sql/20261107_adr_analytics_access.sql`):
  `adr_log_event` accepts routed-company `exported`/`note` events (visibility
  check gains the routed-read branch; all else identical).
- `analytics.js`: `trendsByMonth`, `topReactionTerms`, `seriousnessBreakdown`,
  `outcomeCounts`, `byProductBrand`, `byBatchLot`, `suppressCounts`,
  `SMALL_GROUP_THRESHOLD = 5` (interim). Unknown/blank bucketed, never imputed.
- `PvAnalytics.jsx`: trends, serious-vs-non + six criteria, outcomes, reaction
  terms, product/batch, source, reporter type; every figure captioned with
  n, period, filters; sparse-data banner; small-group suppression; causation
  disclaimer; geographic limitation stated, not estimated; drill-down buttons
  reuse the Tracker's filters (drill opens only already-authorized rows).
- `PvTracker.jsx`: Cases|Analytics tabs, extended filters (outcome, dates,
  reporter type), analytics consumes the same filtered set as cards+list.
- `PvCaseDetail.jsx`: one `note` access event per case view (silent on failure).

## Status: APPLIED live 2026-10-15 (`adr_analytics_access`, branch verified in live function body)

## Rulings

- Suppression threshold 5 is interim; privacy sign-off may adjust. Totals are
  never suppressed — only distribution slices.
- Sparse totals still render with an indicative banner (counts are honest);
  only identity-sensitive slices hide values.
- Drill-down needs no separate permission: it only re-filters authorized rows;
  per-report access is logged at detail open.

## Test evidence

- New: 6 helper tests (RED observed) + 5 section tests (RED observed:
  missing file, then disclaimer/denominator assertions) — all GREEN.
- Full CareHub ADR + permissions: 11 files / 184 tests PASS post-change.
- ESLint: 2 `no-extra-semi` errors caught on first lint pass and fixed;
  re-verified clean; analytics suite re-run 20/20 after the refactor.
- Component suites use renderToString + theme/ui stubs (design-system absent
  from disk — pre-existing gap, same approach as Phase 4).

## Rollback

Unapplied migration: delete the files. UI: revert analytics section + tabs
(Tracker list/detail keep working).
