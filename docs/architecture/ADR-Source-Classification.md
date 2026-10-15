# ADR Source Classification (Phase 5)

## What changed

Report source is now tamper-evident and visible on every surface the master
prompt requires. Nothing about submission flows, validation, or access changed.

- `supabase/migrations/carehub_20261106_adr_source_governance.sql`
  (mirror: `apps/carehub/sql/20261106_adr_source_governance.sql`):
  `adr_lock_report_source` trigger (non-admin source changes rejected),
  `correct_adr_report_source` RPC (admin-only, mandatory reason, writes
  `source_corrected` with from/to/reason), event type added.
- Surfacing (all via the shared `sourceBadge`, no new labels invented):
  Hub analytics "By report source" card (`countBySource`: canonical four keys,
  unknown never guessed); NAFDAC print meta line `Source: …` (E2B unchanged —
  no standard source element, documented); Hub list row badge; Hub detail
  header badge; Tracker list/detail/filters already had badges (Phase 4, untouched).
- Repository `correctReportSource` (audited RPC wrapper).

## Evidence basis per category

- `business_facility`: authenticated business session wrote the row
  (Phase 1 backfill of non-NULL-`business_id` rows + all Hub submissions).
- `public`: public channel (NULL business, owner auth user; Phase 2 flow).
- `health_facility`: RESERVED — no flow sets it; never backfilled; first use
  requires the approved facility workflow + evidence.
- `unknown`: default; means "channel cannot be established", displayed as
  "Source not recorded". Historical rows are re-classified only on reliable
  evidence through the audited RPC.

## Status: APPLIED live 2026-10-15 (`adr_source_governance`, trigger + RPC verified post-apply)

## Test evidence

- New: `countBySource` buckets + never-infers (2), NAFDAC source line (1),
  correction RPC shape (1) — RED observed (4 failures) before GREEN.
- Full CareHub ADR + permissions suites post-change: see closure.
- ESLint on touched files: 0 errors.
- Component coverage for the analytics card/list badges: same environment
  constraint as Phase 2 (renderToString suites used where design-system is
  unresolvable); pure helpers + RPC shapes carry the assertions.

## Rollback

Unapplied migration: delete the files. UI: revert badge/card/export-line edits
(data unchanged — source column and history intact).
