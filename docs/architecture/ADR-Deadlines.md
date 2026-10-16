# ADR Deadlines (Phase 8)

## What changed

Deadlines are versioned data with honest labels; no scheduler was wired
(infra decision deferred — see below).

- `supabase/migrations/carehub_20261108_adr_deadline_rules.sql`
  (mirror: `apps/carehub/sql/20261108_adr_deadline_rules.sql`):
  `adr_deadline_rules` (history-preserving, admin-written, authenticated reads)
  seeded with `brief-2026-10-unverified` (72h/15d/15d/90d/3d, marked UNVERIFIED);
  `adr_active_deadline_rule()`; table-driven `adr_compute_deadline` (labeled
  fallback when no row is active); `adr_stamp_deadline_rule` trigger stamping
  `deadline_rule_version` on every draft→submitted transition (covers both
  submit RPCs without duplicating their bodies).
- JS: `calculateDeadlineWithRule` + labeled `DEFAULT_BRIEF_RULE`;
  `calculateDeadline` delegates (behavior identical, existing tests pass);
  `getActiveDeadlineRule` repository reader.
- UI: Tracker rows carry due-date + status pills; Tracker detail shows
  rule/version, internal-only status, and a safety-signal escalation banner;
  Hub deadline banner names the rule version and disclaims regulatory force;
  the ReportsHub "24-hour NAFDAC/PCN window" claim is removed (unverified).
- `PvTracker` analytics/report filters extended (outcome, dates, reporter type).

## Status: APPLIED live 2026-10-15 (`adr_deadline_rules`; table-driven calculator proven live: 72h and 90d branches)

## Display contract (all deadline surfaces)

Due date + remaining/overdue state + rule version + the sentence: internal
platform deadline, not a regulator-confirmed submission deadline; no action
in CareFind confirms NAFDAC receipt.

## Follow-ups requiring decisions

- Current NAFDAC timelines + classification mapping (PV/regulatory lead) → new
  rule-version row when confirmed; this phase ships zero confirmed values.
- Reminder/escalation delivery (pg_cron vs app cron vs email-outbox job) —
  display and versioning are ready; no job exists yet.
- Small-group/deadline copy review by the privacy lead alongside Phase 4 masking.

## Test evidence

- New: rule-matrix + labeled-default tests, repo reader test, due-pill /
  escalation / deadline-line component tests — RED observed before GREEN.
- Full CareHub ADR + permissions post-change: see closure.
- ESLint on touched files: 0 errors (1 pre-existing warning).
- One process note: two duplicate-import syntax errors and one orphaned-block
  slip caught by the runner this phase; import blocks now verified by read-back.

## Rollback

Pre-apply rollback was file deletion. Applied 2026-10-15: drop the redefined
functions/constraints first (core, submits, verify, module CHECK), restoring
the prior definitions from the earlier migration files. Code: revert helpers + displays
(deadlines fall back to prior unlabeled rendering; stored deadlines untouched).
