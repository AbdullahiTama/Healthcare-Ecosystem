# ADR ICSR Validation (Phase 3, server hardening)

## What changed

The shared gate core is now the single definition of "valid basic ICSR" for
both channels, with machine-readable codes and two documented tightenings.
No form, workflow, or existing-visibility changes.

- `supabase/migrations/carehub_20261104_adr_icsr_hardening.sql`
  (mirror: `apps/carehub/sql/20261104_adr_icsr_hardening.sql`):
  - `adr_reports.module_type` CHECK widened with `'public'` (additive).
    Public drafts are created with `module_type='public'` and are bound only
    by the general core (no module clause references it).
  - `adr_icsr_missing(uuid, OUT missing, OUT fields)`: shared core returning
    labels + stable `{id, label}` codes. All pre-existing labels byte-identical.
  - Contact rule (Ruling 1): reporter phone/email, else the submitting
    facility's registered contact. Public rows (NULL business) can only pass
    reporter-side — the Phase 2 strict rule with the identical label.
  - Skincare parity (Ruling 2): server enforces the five formEngine-mandatory
    skincare fields. Conditional scoping preserved everywhere (industry /
    hospital / skincare clauses fire only for their module).
  - Both submit RPCs attach `missingFields`; both set `gate_validated_at`.
  - `verify_adr_product_route` raises until the parent report carries
    `gate_validated_at` — no verified company access for unvalidated cases.
- `apps/carehub/src/modules/adr/validation.js`: client twin of both rulings
  (contact prompt + skincare submit gates, matching ids). Note: the client
  cannot see the facility fallback, so it prompts for reporter contact unconditionally.
- `apps/carefind/.../safety-report/`: `createDraft` sets `module_type='public'`
  (without it the NOT NULL column rejects every public draft); server-label map
  gains 'All six seriousness fields'.

## Status: APPLIED live 2026-10-15 (`adr_icsr_hardening` + `adr_verify_event_restore` correction; live gate returns structured errors, verified on real data)

Superseded: applied live — see `ADR-Release-Record.md` §4. The sentence this
replaces (claiming no migration applied) predates the reviewed apply.

## Rulings

- Ruling 1 (contact): a Hub report with neither reporter nor business contact
  newly fails. Justification: §6 requires a contact route for valid basic
  ICSR; facility accounts virtually always carry one. Cost if wrong: a small
  set of legacy contact-less drafts needs a contact added — data-quality win.
- Ruling 2 (skincare parity): skincare drafts in flight must fill the five
  fields. Justification: formEngine already marks them mandatory; the server
  lagged industry/hospital. Cost if wrong: same class of rework as Ruling 1.

## Intentionally deferred

3-state seriousness columns (booleans + unknown-array stand), deadline-rule
engine, Tracker/analytics/exports, live-DB RLS probe tests (required at first
staging apply), PG-backed RPC tests (repo has a `*.pg.test.js` pattern worth
reusing when a test database is available).

## Test evidence

- CareHub `validation.test.js`: 42/42 (40 existing incl. updated valid fixture
  + 2 new: contact route, skincare parity). RED observed (2 fail) before GREEN.
- Full CareHub ADR suite post-change: see commit/closure (no other module touched).
- CareFind pure suites re-run for the `module_type` payload assertion: see closure.
- Component suite (`SafetyReport.test.jsx`): still environment-blocked locally;
  CI must run it (carried residual from Phase 2).

## Rollback

Pre-apply rollback was file deletion. Applied 2026-10-15: drop the redefined
functions/constraints first (core, submits, verify, module CHECK), restoring
the prior definitions from the earlier migration files. Code twins: revert the validator edits
(server strings are the authority; clients degrade to prompting less, never to
accepting more than the server).
