# ADR Routing Foundation (Phase 1, Unified PV)

## What changed

Additive backend foundation for shared ADR + product-owner routing. No Hub
form, validation, or existing-visibility changes.

- `supabase/migrations/carehub_20261102_adr_routing_foundation.sql`
  (mirror: `apps/carehub/sql/20261102_adr_routing_foundation.sql`, byte-identical):
  - `adr_reports.report_source` (`public|health_facility|business_facility|unknown`,
    default `unknown`; existing business rows backfilled to `business_facility`),
    `origin_channel_detail`, `deadline_rule_version`; `business_id` widened to nullable.
  - `business_aliases` (approved search aliases, names only, FK to `businesses`).
  - `adr_product_company_routes` (per-product `verified|unknown|unverified_candidate`,
    `pending|verified|routed`, `idempotency_key UNIQUE`, exactly-one-reference CHECK).
  - `adr_report_events.event_type` widened with
    `routing_created|routing_verified|routing_routed|verification_recorded|history_linked`.
  - RPCs: `create_adr_product_route` (idempotent, DEFINER), `verify_adr_product_route`
    (admin-only, DEFINER), `search_eligible_product_companies` (DEFINER, 5 public columns),
    helper `is_eligible_product_company`. RLS on both tables; analytics view + `report_source`.
- `apps/carehub/src/modules/adr/routing.js` — public label constant, source/kind/status
  enums, `normalizeCompanyName`, `buildIdempotencyKey`, `validateRouteInput`,
  `isEligibleBusinessType` (pure, tested).
- `repositories/index.js` — three appended methods (`getProductRoutes`,
  `createProductRoute`, `searchEligibleCompanies`); no existing method touched.

## Status: APPLIED live 2026-10-15 (`adr_routing_foundation`, verified post-apply; view-column fix committed pre-apply)

Superseded: this migration is applied live — see `ADR-Release-Record.md` §4
for the applied-migrations table and verification evidence. Production
sign-off references in earlier drafts now apply to future changes, not to
this migration.

## RLS matrix delta

| Reader | Existing rows | New public rows (`business_id` NULL) | Routes |
|---|---|---|---|
| Platform admin | all (unchanged) | all | all |
| Submitter chain (owner/manager/own staff) | unchanged | none (NULL matches nothing) | own report's rows |
| Verified responsible org | none (unchanged) | none until Phase 4 | only `routed` rows pointing at it |
| Unverified / typed-name company | none | none | none (candidates never satisfy the routed branch) |

## Rulings made during implementation

- `search_eligible_product_companies` is SECURITY DEFINER, not INVOKER:
  `businesses` RLS is own-row-only, so INVOKER could never list other companies.
  Narrowly scoped to 5 already-public directory columns of active
  Importer/Manufacturers. Cost if wrong: over-exposure of business directory
  fields — mitigated by column whitelist + active/eligible filter.
- No per-product uniqueness beyond `idempotency_key`: Hub multi-company
  cardinality is unresolved, so the single-company public rule stays an
  application-layer rule for Phase 2. Cost if wrong: duplicate routing rows —
  mitigated by idempotency keys + admin verification.
- Seriousness stays boolean (no 3-state Unknown column): schema change deferred
  pending the §7 regulatory decision; Unknown must keep living in form copy,
  not coerced to No. Cost if wrong: regulatory mis-mapping — blocked from prod.

## Completion audit — business taxonomy decisions (2026-10-16, no code change)

- Stored `business_type` values for eligible product companies are exactly
  `manufacturer_importer` (single combined Importer/Manufacturer type — there
  are no separate `manufacturer`/`importer` stored values) and `wholesale`.
  The JS helper (`routing.js`) and the SQL gate
  (`is_eligible_product_company`, type-ahead) use identical sets; SQL
  additionally requires `status = 'active'`.
- `business_type` has no DB CHECK/enum (free TEXT); the values above are a
  convention enforced by the eligibility predicates, not the schema.
- `wholesale` inclusion predates this work (permissions `ENTERPRISE_TYPES`,
  role templates, ADR industry mapping, docs). No documented product decision
  either way was found — **kept as-is; explicit product sign-off required
  before adding or removing any eligible type** (owner decision D1).
- Registration gap (no code change): the current signup UI
  (`config/constants.js` `BUSINESS_TYPES`, `Register.jsx`) offers none of the
  enterprise types and defaults to `skincare` — eligible companies cannot
  self-register today and must be provisioned/converted out-of-band.
  **Product decision required** (owner decision D2): add
  Importer/Manufacturer options to registration or keep admin-provisioned.

## Intentionally deferred

3-state seriousness, deadline-rule engine (only a version column stub),
PV Tracker UI, public submission flow, historical-linking procedure
(requires admin verification per route), server exports, deadline cron.

## Test evidence

- Baseline before changes: 5 files / 88 tests PASS.
- New `routing.test.js`: 25 tests (21 pure + 4 repository adapter) PASS;
  existing `repositories/index.test.js` 19/19 PASS (no regressions).
- Full `src/modules/adr` suite re-run post-change: see commit message / final report.
- ESLint on changed source files: 0 errors (test files are eslint-ignored by repo config).
- Migration correctness: static self-review against the 5 Review Focus lines
  (plan §Review Focus), then a reviewed live apply on 2026-10-15 with RLS
  probe tests (anon / guessed-UUID / cross-tenant / idempotent retry) —
  see `ADR-Release-Record.md` §4 for evidence.

## Rollback

Pre-apply rollback was file deletion. Post-apply rollback (reverse order):
drop RPCs/helper → drop route/alias RLS + tables → restore analytics view →
restore events CHECK → drop added columns (data loss of routing data only;
core ADR rows untouched). No existing column is narrowed.

## Rollback

Pre-apply rollback was file deletion (the two files). Applied 2026-10-15 — post-apply rollback
(reverse order): drop RPCs/helper → drop route/alias RLS + tables → restore
analytics view → restore events CHECK → drop added columns (data loss of
routing data only; core ADR rows untouched). No existing column is narrowed.
