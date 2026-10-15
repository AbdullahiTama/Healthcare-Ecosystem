# ADR Public Reporting (Phase 2, CareFind safety journey)

## What changed

Public ADR/Safety Report journey, confidential end to end, sharing the Phase 1
backend. Nothing in the Hub module was touched (no form/validation/export change).

- `supabase/migrations/carehub_20261103_adr_public_access.sql`
  (mirror: `apps/carehub/sql/20261103_adr_public_access.sql`):
  public-draft ownership (`reporter_auth_user_id`), ternary seriousness
  (`seriousness_unknown[]`), `gate_validated_at` validity stamp, shared gate core
  (`adr_icsr_missing`, `adr_compute_deadline`), Hub `submit_adr_report` preserved
  (INVOKER, delegates to core, identical behavior + stamp), new
  `submit_adr_public_report` (DEFINER, owner-only, +contact-route and +ternary
  extras), reporter RLS branches (read own any-status; write draft-only; direct
  PATCH can never flip draft→submitted; owner may delete own draft only),
  child/route/event policy extensions, `create_adr_product_route` accepts
  public-draft writers (draft-only), private `adr-private` bucket (owner-folder
  policies), analytics + `gate_validated_at`.
- `apps/carefind/src/modules/safety-report/`: `constants.js` (verbatim labels),
  `validation.js` (client twin + ternary mapping + key builders),
  `repository.js` (confidential-tables-only supabase wrappers, private-bucket
  attachments via signed URLs), `useSafetyDraft.js` (server-truth drafts,
  debounced autosave, retry), `ui.jsx` (token-styled accessible primitives),
  `CompanyPicker.jsx`, `steps/` (Reporter/Patient/Products/Reactions/Additional/Review),
  `SafetyReportPage.jsx` (welcome → 6 steps → review → success).
- Entry: `Feed.jsx` CREATE_OPTIONS += Safety Report → `/report-side-effect`;
  `main.jsx` lazy route behind RequireAuth. Zero `posts` writes from the module
  (grep-verified; only a comment and a test name mention the word).

## Status: REVIEW ONLY — not applied anywhere

Neither migration (Phase 1 nor Phase 2) has been applied to any database.
First apply must be a reviewed staging migration with RLS probe tests
(anon / guessed-UUID / cross-tenant / direct-PATCH-flip / contact-less RPC /
idempotent retry / candidate-no-grant / private-bucket URL guessing).

## Rulings made during implementation

- Login required, no guest reporting: CareFind posting is login-gated and
  draft ownership keys on auth.uid(). Cost if wrong: excludes offline guests —
  accepted; facility-anon path covers third-party reporting.
- Patient identifier interim guidance ("initials or code, not a full name"):
  the initials-vs-full-name conflict (§7.2) is still regulator-unresolved, so
  the UI steers to data minimization. Cost if wrong: rewording after sign-off.
- Ternary seriousness stored as `seriousness_unknown[]` + booleans true-for-Yes:
  Not-sure stays distinct, never coerced. Cost if wrong: migration rework in Phase 3.
- Profile prefill best-effort (display_name + auth email), all editable;
  qualification intentionally not defaulted. Cost if wrong: none (explicit choice required).
- Continue-draft resumes the most recent draft; older drafts persist untouched.
  Multi-draft management deferred. Cost if wrong: minor UX follow-up.

## Intentionally deferred (per master order)

Phase 3 server ICSR hardening beyond the public extras, PV Tracker UI,
source-classification backfill UI, analytics, exports, deadline engine/cron,
priv-sec hardening pass, E2B workflow confirmation.

## Test evidence

- `validation.test.js`: 18 tests PASS. `repository.test.js`: 7 tests PASS
  (fake-client mapping + RPC shapes + never-posts assertion).
- `SafetyReport.test.jsx` (9 tests: welcome/entry/gating/autosave-quiet/Review/
  CompanyPicker): UNKNOWN locally — this machine cannot complete jsdom suites
  in reasonable time (a trivial 6-test file timed out at 240s with 3.7GB RAM
  free; raw transform/CPU slowness, also observed pre-change). The suite ran
  green through transform after two real bugs were fixed from its output
  (step-import paths, `window.scrollTo` stub per repo convention). **CI must run
  `vitest run src/modules/safety-report` and pass before any staging apply.**
- Feed separation: `grep posts|postRepository|startPost|createPost` over the module
  returns only a comment and a test name.
- CareHub ADR regression: 6 files / 113 tests PASS post-Phase-2 (no CareHub
  source modified in Phase 2).
- ESLint: 0 errors over all 15 touched/new files.
- CareFind `npm install` was required to repair the local runner
  (`.bin/vitest` missing — pre-existing environment gap, not a code change).

## Rollback

Unapplied migrations: delete the four files. CareFind: revert the module +
two one-line wiring edits (Feed option, main route). Draft rows (if migration
ever applied): owner-deletable while draft; submitted rows need the
approved retention handling, not hard delete.
