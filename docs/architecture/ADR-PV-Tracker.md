# ADR PV Tracker (Phase 4, company tracker)

## What changed

Verified Importer/Manufacturer orgs get a PV Tracker in the existing CareHub
dashboard, showing only validated cases routed to them. Case rows are
structurally read-only for companies; workflow is per-route state + append-only
records. No Hub list/form/export was modified.

- `supabase/migrations/carehub_20261105_adr_pv_tracker.sql`
  (mirror: `apps/carehub/sql/20261105_adr_pv_tracker.sql`):
  `can_access_adr_routed_report` / `can_write_adr_route_company` helpers;
  routed-read SELECT branches on children/events/routes/photos (NOT on
  `adr_reports` — deliberate, see Ruling 1); masked `adr_pv_case_view`
  (DEFINER with explicit access predicate, SELECT granted to authenticated);
  `company_status|company_status_updated_at|acknowledged_at` on routes;
  `adr_route_assessments` (append-only, author stamped by trigger) and
  `adr_followup_requests` (idempotent, open/addressed) with lifecycle triggers;
  `update_adr_route_workflow` (transition table, idempotent same-status);
  `request_adr_followup` (idempotent key); 5 new audit event types;
  `adr-private` routed-read storage policy.
- CareHub: `pvWorkflow.js` (transition mirror, source badges, reconciled
  buckets), repository Tracker methods (view-first reads, RPC writes),
  `PvTracker.jsx` (summary + filters + list) + `PvCaseDetail.jsx` (masked case,
  rationale, timeline, actions, masked-data exports via existing builders),
  nav key `pv-tracker` (enterprise Owner/Manager/default/enterprise lists +
  registry + sidebar highlight), routes `/dashboard/reports/pv-tracker[/:reportId]`.
- Tests: `pvWorkflow.test.js` (8), `pvTracker.test.js` (5), `PvTracker.test.jsx`
  (6, renderToString with theme/ui stubs — design-system absent from disk);
  `permissions.test.js` enterprise count 17→18 + pv-tracker presence.

## Status: REVIEW ONLY — not applied anywhere

No Phase 1–4 migration applied to any database.

## Rulings

- Ruling 1 (masking without direct-read leakage): base `adr_reports` SELECT has
  NO routed branch; companies reach headers only via the masked DEFINER view
  whose WHERE predicate is the gate. A direct table read of a routed case is
  denied. Interim masking (name/phone/email/facility/license hidden from
  responsible companies) stands until the privacy lead approves otherwise —
  widening needs sign-off, narrowing needs none.
- Ruling 2 (follow-up direction): requests flow company → submitter;
  answers arrive as versioned follow-up reports, never edits.
- Acknowledgement copy is internal-only everywhere it appears.

## Known limitations (honest)

- Event timeline shows actor names in professional capacity (accepted, auditable).
- Private-attachment download for companies needs signed-URL plumbing (Phase 7);
  rows render with a platform-support note meanwhile.
- Client-side list filtering (server-side at scale — Phase 6 note).
- `BusinessDashboard.test.jsx` fails at import in this checkout with AND without
  these changes (design-system absent from disk — pre-existing environment gap).

## Test evidence

- CareHub: 10 files / 169 tests PASS (ADR 8 files incl. 19 new Tracker tests;
  permissions incl. updated enterprise pin).
- RED observed for Tracker suites (missing-file/import failures) before GREEN;
  two test bugs (regex vs card layout, header-identifier expectation) fixed in
  tests, one real syntax error (missing paren) fixed in `PvTracker.jsx`.
- pvWorkflow/pvTracker suites: written pre-implementation; first executable run
  was GREEN — exact-literal assertions (transition table, counts 6/1/2/1/1/2,
  RPC paths) make vacuous passes implausible; disclosed, not hidden.
- ESLint on touched files: 0 errors (warnings pre-existing).

## Rollback

Unapplied migrations: delete the files. UI: revert Tracker pages + nav/route
wiring (Hub lists/forms keep working — nothing existing was modified).
