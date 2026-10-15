# ADR Unified Reporting & PV Tracker — Release Record (Phases 0–10)

## 1. What existed before

CareHub ADR module (4 module types, twin-gate validation, role-aware RLS,
append-only events, analytics view, NAFDAC-print + E2B-flavoured exports);
CareFind Create selector (10 options, feed posts); two business directory
systems; email-outbox + notifications infra. No PV Tracker, no routing, no
source classification, no public channel, no validity stamp.

## 2. Implemented and tested

| Phase | Code | Tests (all green where run) |
|---|---|---|
| 0 | Audit report + decision log (no code) | n/a |
| 1 | Routing foundation: source column, aliases, per-product routes, search/verify RPCs | 25 routing/repo tests |
| 2 | Public wizard (welcome→6 steps→review→success), drafts, private bucket, public submit RPC | 17 validator + 8 repo + 3 separation tests; 9 component tests CI-bound |
| 3 | Coded ICSR core, contact fallback, skincare parity, verify-requires-valid | 42 validation tests (RED observed) |
| 4 | Masked DEFINER case view, workflow RPCs, assessments/follow-ups, Tracker UI + nav | 19 tracker/workflow/UI tests |
| 5 | Source immutability trigger, audited correction RPC, badges/analytics/export surfacing | 4 surfacing tests (RED observed) |
| 6 | Access-log branch, analytics helpers + Tracker section (suppression, disclaimers, drill-down) | 11 analytics tests (RED observed) |
| 7 | CSV/bulk/analytics builders, export wiring, per-report bulk audit, E2B prep-only labeling | 12 export tests (RED observed) |
| 8 | Versioned deadline rules, table-driven calculator, stamping trigger, labeled displays | 3 deadline tests + UI tests |
| 9 | Delete guards (proven live, rolled back), submit EXECUTE hardening, rule-change audit, adversarial probes | live probes, zero residue |
| 10 | Separation pin, this record | see §6 |

## 3. Implemented but not deployed

All application code (CareHub Tracker + wizard + validators + exports) is
committed on `main`, NOT deployed — no frontend deploy was performed in this
program. Database migrations 1–9 ARE applied live (see §4).

## 4. Migrations applied live 2026-10-15 (explicit owner authorisation)

`adr_routing_foundation`, `adr_public_access` (+reactions-read correction),
`adr_icsr_hardening` (+verify-event restore), `adr_pv_tracker`,
`adr_source_governance`, `adr_analytics_access`, `adr_deadline_rules`,
`adr_trigger_execute_hardening`, `adr_delete_guards`. Each verified post-apply;
data untouched (36/2/3/40, 0 routes). Rollback: additive schema — drop in
reverse dependency order (RPCs → views/policies → tables/columns); no data
migration to reverse except the source backfill (reversible by update) and the
single rules seed row.

## 5. Blocked by regulatory/privacy approval (NOT production-ready claims)

Current NAFDAC timelines + classification mapping; minimum valid ICSR data;
patient identification (initials vs names); retention/access policy; deadline
mapping confirmation; accepted PDF/CSV + E2B version + submission workflow;
anonymous-reporting exceptions; notification templates/recipients;
suppression threshold + masking width; E2B as a submission channel (explicitly
NOT represented as one anywhere). No compliance is claimed by building screens.

## 6. Test evidence (exact commands, real results)

- `npx vitest run src/modules/adr src/lib/__tests__/permissions.test.js` (apps/carehub): **12 files / 202 tests PASS** (rear-guard run; Phase 10 adds separation pin).
- `node_modules/.bin/vitest run src/modules/safety-report/separation.test.js` (apps/carefind): **3/3 PASS**.
- `validation.test.js` + `repository.test.js` (carefind safety): **17 + 8 PASS**.
- Live probes: anon denial everywhere; structured gate on real data; delete guards (rolled back, zero residue); calculator branches; grant/search_path/advisor review.
- ESLint: **0 errors** on all touched files (CareHub sweep + safety-report module clean; remaining warnings pre-existing).
- Builds: CareHub `npm run build` → **✓ built in 4m 2s**; CareFind `npm run build` → **✓ built in 4m 36s** (both include all Phase 2–8 UI; chunk warnings only).
- `SafetyReport.test.jsx` (9 component tests): environment-blocked locally, **CI-bound** (jsdom suites cannot complete on this box; proven pre-existing).

## 7. Security implications and risks

- New DEFINER surface is authenticated-only with in-body access checks; one
  intentional advisor ERROR (masked view) with documented predicate control.
- Company access requires verified route + validated report; candidates grant
  nothing; direct case PATCH/DELETE by companies impossible (no grants + guard
  triggers); admin break-glass remains platform-audited.
- Residual risks: staging RLS-as-user matrix unrun (no test users in prod);
  notifications unwired; column encryption not implemented; other agents active
  in this checkout (all ADR commits pathspec-scoped; unrelated tree changes
  observed and left untouched).

## 8. Required sign-offs before production release of the feature

PV/regulatory lead (timelines, ICSR minimum, patient ID, E2B version/workflow,
anonymous exceptions) and privacy lead (masking, suppression, retention/access,
notification recipients) — documented per item in §5. Do not release the public
reporting flow or company Tracker access until both sign.
