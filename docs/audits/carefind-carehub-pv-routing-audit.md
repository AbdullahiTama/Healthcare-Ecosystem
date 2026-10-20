# CareFind → CareHub PV routing audit (Phase 0, read-only)

Date: 2026-10-20. Branch/HEAD inspected: `main` @ `a0d515d` (clean tree, tracks `AbdullahiTama/main`).
No code, schema or production data was changed by this audit. The only artefact added besides this file is a failing
PGlite probe (`apps/carefind/src/test/adr/routeSelfPromotion.probe.db.test.js`) that becomes the regression test for P0-1.

Missing prerequisite docs: `docs/PROJECT_OVERVIEW.md`, `planning/ROADMAP.md`, `planning/CODE_AUDIT.md` do not exist in this checkout
(CLAUDE.md tells the engineer to read them). README, `docs/architecture/ADR-*.md` and the SQL were read instead.

## 1. Source vs live migrations vs deployed app

| Layer | State | Evidence |
|---|---|---|
| Source | ADR routing, public access, ICSR, tracker, governance, single-company, notify all on `main` (`apps/carehub/sql/2026110x…2026111x`, mirrored in `supabase/migrations/carehub_*`). | git |
| Live DB (project `szdybxmgmhndoytqanfb`) | All 18 ADR migrations present in `schema_migrations` (`adr_routing_foundation` … `carehub_20261112_adr_notify_party`). Policies on `adr_product_company_routes`, column grants and triggers read live (read-only `pg_policies`/`information_schema`) match the source. | MCP read-only queries, 2026-10-20 |
| Live data | 5 public reports; **4 routes, all `status='pending'`** (2 `unknown`, 2 `verified`-kind). 0 routed, 0 verified. | same |
| Deployed frontend | **UNVERIFIED.** Release record §3 says app code was not deployed in that program; `main` is the Vercel production branch, so later pushes may have deployed it. Evidence needed: Vercel deployment list for `carehub` and `healthcare-ecosystem` (commit SHA of the live production build) and whether `/report-side-effect` and `/dashboard/reports/pv-tracker` exist in the live bundles. |
| `master` | Default branch is `master`, newer work is on `main`. Which is intended for production is UNVERIFIED (Vercel project "Production Branch" setting). Treat `main` as production per project memory. |

## 2. Traced lifecycle (one public case)

1. CareFind `SafetyReportPage.jsx` → `useSafetyDraft` creates `adr_reports` draft (`repository.createDraft`: `report_source='public'`, `business_id=NULL`, `reporter_auth_user_id=auth.uid()`).
2. Products step: `CompanyPicker` yields `verified` (registry search via `search_eligible_product_companies`), `unverified_candidate` (typed) or `unknown`. `persistProducts` (`SafetyReportPage.jsx:87`) saves each product then calls `create_adr_product_route` with a deterministic idempotency key (`buildRouteKey`). **Routes are persisted before submit, on every step advance and again in `handleSubmit`; retries return the existing row (verified by PGlite test "retrying with the same key").**
3. `create_adr_product_route` (DEFINER): checks draft ownership, product∈report, eligibility for `verified` (`is_eligible_product_company`: active + `manufacturer_importer|wholesale`), inserts **`status='pending'`**, logs `routing_created`. Trigger `trg_adr_public_single_company` limits public products to one route.
4. `submit_adr_public_report` (DEFINER): owner-only, draft-only, public extras (contact, ternary seriousness) + `adr_icsr_missing`; sets `status='submitted'`, `submission_deadline`, `gate_validated_at`. **It does not touch routes and creates no notification.**
5. Only `verify_adr_product_route(route_id, notes)` moves a route off `pending`: requires `is_platform_admin()`, report `gate_validated_at IS NOT NULL`, not `unverified_candidate`, business still eligible; `verified` kind → `routed`, `unknown` → `verified`. Logs `routing_verified`. (`routing_routed` event type exists but is never written.)
6. CareHub `PvTracker.jsx` → `getRoutedRoutes(brand.id)` = `adr_product_company_routes?responsible_business_id=eq.<id>&status=in.(verified,routed)`, then `getPvCase` per route (masked `adr_pv_case_view`, children via routed-read RLS).

## 3. The 12 explicit questions

1. **Business selection:** registry type-ahead RPC (active Importer/Manufacturer + wholesale, plus approved aliases); typed text and "I don't know" are separate kinds.
2. **Persisted before submission / idempotent:** yes; unique `idempotency_key`; retry returns the same row, one `routing_created` event.
3. **`submit_adr_public_report`:** validates, stamps `gate_validated_at`, flips status. Nothing else.
4. **Route status on creation:** `pending`.
5. **What makes `routed`:** only `verify_adr_product_route`.
6. **Admin queue / UI consumer:** **none.** `git grep verify_adr_product_route` over `apps/*/src` (non-test) returns nothing. The RPC is callable only by hand-written SQL/REST.
7. **Notifications on routing events:** **none.** `notify_adr_party` is invoked from exactly one place, `AdrReportPage.jsx:284` (follow-up versions). Nothing calls it on route creation, verification or public submission, and verify does not call it.
8. **Tracker filter:** exact `responsible_business_id` and `status in (verified,routed)`; correct. It does not itself check `gate_validated_at` (the verify RPC does), so a route set to `routed` by any other path exposes an unvalidated case — see P0-1.
9. **Open tracker learns of new routes:** no. Load runs once per `brand.id`; no refresh button, no realtime, no polling.
10. **What a routed company can read:** masked case view (reporter name/phone/email/facility/licence hidden; **patient identifier, age, DOB, gender, weight, history, narrative and batch are visible**), products, meds, reactions, evidence-photo rows, events, routes for the report (own routed routes only), assessments, follow-ups. Storage policy `adr-private routed read` lets the company read objects whose path matches an evidence row of a routed report, but `PvCaseDetail.jsx:244-249` only renders a link when the stored value starts with `http`; private paths render as text. **No signed-URL flow exists.**
11. **"I don't know" / typed company:** route is created (`unknown` / `unverified_candidate`), stays `pending` forever; no access (correct) but also **no reviewer queue, no alert, no resolution path.** Verify RPC refuses candidates by design ("register the business first") with no alternative workflow.
12. **Deployed = source?** UNVERIFIED (see §1); DB matches source.

## 4. Findings

### P0
- **P0-1 Reporter can self-route and bypass admin verification and eligibility.** `adr_routes update` policy (`USING/WITH CHECK can_write_adr_public_draft(report_id)`) has no column restriction and `authenticated` holds column UPDATE on `status`, `responsible_business_id`, `selection_kind`, `company_status`, `verified_*` (confirmed live). Policies are `TO public`. PGlite replay of the real migrations: a draft owner ran `update … set selection_kind='verified', responsible_business_id=<ordinary pharmacy>, status='routed'` and it succeeded. After `submit_adr_public_report` the case (including patient data) appears in that business's tracker, with no eligibility check, no admin, no audit event (no trigger on UPDATE). Same hole lets a reporter target any competitor. The probe fails today. **Live exploitation not attempted; live behaviour = UNVERIFIED but policies, grants and triggers are identical to the replayed source. Production currently has 0 routed routes and no tracker-visible rows, so no exposure has occurred through current data (checked: all 4 routes pending).**
  **Status 2026-10-20: fix drafted, NOT applied** — `supabase/migrations/carehub_20261113_adr_route_write_guard.sql` (mirror in `apps/carehub/sql/`), regression `apps/carefind/src/test/adr/routeWriteGuard.db.test.js` (6 tests; with the existing adversarial suite 20/20 pass on PGlite). Owner decision recorded: reviewer approval (policy B) is the routing policy.
  Fix direction (as implemented): a BEFORE INSERT/UPDATE trigger (and/or REVOKE UPDATE on privileged columns) that makes `status`, `responsible_business_id`, `selection_kind`, `verified_*`, `company_status*` writable only via the DEFINER RPCs; reporter may only change selection while draft and only through `create_adr_product_route`. Requires a production migration → needs approval.
- **P0-2 Delivery is structurally broken:** no code path moves any route to `routed` for a normal user (no admin UI, no auto-routing), so no CareFind report can ever reach a company. Live data proves it: 5 public reports, 0 visible to any company.

### P1
- P1-1 No notification at any routing event; reviewers and companies learn nothing. `notify_adr_party` recipients rely on `staff.role ILIKE '%manager%'`, not the permission model, and only owner+managers.
- P1-2 Unknown/typed-company routes are dead ends (no queue, no alert, no resolution; single-company trigger blocks a second route, so resolution must update the existing row through an audited RPC).
- P1-3 Tracker collapses routes per report by taking the *first* route in `created_at desc` order (`PvTracker.jsx:197-203`; the comment says "most advanced", the code does not). `PvCaseDetail.jsx:102` uses `myRoutes[0]`. With several products at one company, status and the actions shown/applied are arbitrary and `update_adr_route_workflow` changes a route the user may not realise they chose. Also N+1 `getPvCase` per route.
- P1-4 Attachments unusable for companies (no signed URL); UI also implies "View" for http legacy URLs only.
- P1-5 Follow-up requests on public cases reach nobody: `notify_adr_party` returns `no-business-recipient`, and the reporter has no inbox. `PvCaseDetail` toasts "sent to the reporting facility".
- P1-6 Tracker has no refresh action and no "last updated"/route status display.
- P1-7 Routed-company visibility of patient identifier/age/DOB etc. is an unsigned privacy decision (release record §5/§8 requires privacy-lead sign-off before releasing company Tracker access).

### P2
- Single-company trigger has a documented concurrency gap (check-then-insert).
- `routing_routed` event type never written; route status `verified` for `unknown` kind is semantically odd.
- `notify_adr_party` grants any caller with report access the ability to fire notifications to other tenants (rate-limited only by a 1h dedupe on link).
- `business_aliases` readable by every authenticated user (names only).
- SafetyReport component tests are CI-bound locally (jsdom hangs) — carried over from prior reports.
- Eligible-company taxonomy (D1) and registration gap (D2) still unsigned: no company can self-register as Importer/Manufacturer.

## 5. Unresolved decisions (owner)
1. **Routing policy A vs B** (auto-route a registry-selected company after the gate passes, vs. PV/admin approval). Trade-off: A is immediate and stays invisible-free but trusts the reporter's selection (provenance must be recorded as "reporter-selected, not verified"; wrong company receives patient data); B protects privacy but requires staffed reviewers, an SLA and alerts or reports stall (today's state). **Recommendation: B for the first release (human check before disclosure of health data to a third party), with a queue and reviewer alert, and an explicit 'auto-route' switch later.** Needs your decision.
2. Who counts as a platform reviewer (`is_platform_admin()` only, or a PV role).
3. Notification recipients inside a company (owner / PV role / managers / all tracker users) and copy sign-off (D6).
4. Disclosure width for routed companies (patient fields), attachments allowed or not.
5. Case model: business-level grouping with product-route detail (recommended) vs per-route work items.
6. Whether to deploy: nothing here is deployed by this work.

## 6. Remediation plan (testable)
0. Migration M1 (P0-1): route-write guard trigger + grants; PGlite regression = the probe, plus tests that DEFINER RPCs still work. **Apply only with approval.**
1. Migration M2: `adr_route_review` model — queue view (submitted + validated + pending), `review_adr_product_route(route_id, action approve|redirect|hold, reason, new_business_id)` re-checking eligibility/validity, idempotent, audited (`routing_routed` events), resolution of candidate→eligible business via update of the existing route (keeps the one-per-product rule).
2. Notifications: server-side, inside the routing RPC, failure-isolated (savepoint), logged to an outbox/ops table; reviewers alerted on submit via trigger; company alerted on route; uses existing `staff_notifications`.
3. CareHub: reviewer queue page, tracker refresh/"last updated", grouped case model, signed-URL attachments.
4. Tests per Phase 7 list; builds and lint per Phase 8.

## 7. Evidence still needed for UNVERIFIED items
Vercel production deployment SHA/branch for both projects; read-only `select` of `pg_proc.prosrc` for `verify_adr_product_route`/`submit_adr_public_report` (to confirm live bodies equal source); a rolled-back `DO` block impersonating a test draft owner would prove P0-1 live (not run — it writes, even if rolled back, and needs approval).
