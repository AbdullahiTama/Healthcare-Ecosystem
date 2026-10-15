# Phase 1: Shared ADR Backend & Product-Owner Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add report-source classification, per-product company routing with verification states, and company search to the existing ADR backend without changing the Hub form, validation gate, or existing RLS behaviour for current rows.

**Architecture:** One additive SQL migration (new columns nullable/with defaults, two new tables, widened event-type CHECK, new SECURITY DEFINER/INVOKER helpers + two RPCs, additive RLS policies, analytics view +1 column) mirrored to `apps/carehub/sql/`; one new pure-JS helper module `routing.js` + repository methods + vitest suite; docs update.

**Tech Stack:** Postgres 15 (RLS, SECURITY DEFINER/INVOKER, trigram-ready), Supabase PostgREST, Vitest 2.

**Spec:** Master Engineering Prompt §§4.1–4.4 + Phase 0 audit (report 2026-10-15). Existing source of truth: `supabase/migrations/carehub_20260816_adr_reports_basic.sql`, `carehub_20260818_adr_reports_phase1.sql`, `carehub_20260818_adr_phase2_*.sql`, `carehub_20260819_adr_fix_returning_rls.sql`; frontend `apps/carehub/src/modules/adr/{types,validation,services,repositories/index}.js`.

## Global Constraints

- Do NOT modify the Hub ADR form, its fields, validation rules, or `submit_adr_report()` ICSR gate behaviour.
- Do NOT create a duplicate ADR module or a parallel company registry; reuse `businesses` (`manufacturer_importer`/`wholesale`).
- `business_id` widening (NOT NULL → nullable) only; no destructive DDL; every `ADD COLUMN`/`CREATE` uses `IF NOT EXISTS`.
- Manual company text NEVER becomes a verified org automatically; unverified candidates get zero confidential rows.
- Routing RPC is idempotent (idempotency_key UNIQUE, ON CONFLICT DO NOTHING).
- No production migration apply, no production data change, no deploy in this phase.
- Public label verbatim: "Company responsible for this medicine/product in your country (if known)".
- Seriousness Unknown stays distinct from No (no schema change to booleans in this phase; 3-state deferred with decision log).

## Review Focus

- Public report with `business_id NULL` visible to non-admin via SELECT policy — expect admin-only until Phase 4 extends visibility.
- `responsible_business_id` pointing at a non-Importer/Manufacturer or inactive business — expect RPC rejection.
- Retry with same idempotency_key creating a second route — expect single row returned.
- Unverified-candidate route readable by the named company — expect denied (no confidential leak).
- Existing Hub rows (`business_facility`, non-NULL business_id) changing visibility — expect unchanged.

---

### Task 1: SQL migration — source, routing, verification, search

**Files:**
- Create: `supabase/migrations/carehub_20261102_adr_routing_foundation.sql`
- Create (mirror): `apps/carehub/sql/20261102_adr_routing_foundation.sql`
- Test: static review + existing suite (no live DB apply in this phase)

**Interfaces:**
- Consumes: `businesses(id, business_type, status)`, `adr_reports(report_id, business_id, created_by_user_id)`, `adr_report_products(product_id, report_id)`, `can_access_adr_report(uuid)`, `can_access_adr_report_row(uuid,uuid)`, `is_platform_admin()`, `adr_report_events(report_id, event_type, ...)`.
- Produces: columns `adr_reports.report_source|origin_channel_detail|deadline_rule_version`; tables `business_aliases`, `adr_product_company_routes`; RPCs `create_adr_product_route(uuid,uuid,uuid,text,text,text)`, `verify_adr_product_route(uuid,text)`, `search_eligible_product_companies(text,int)`; widened `adr_report_events.event_type` CHECK; helper `is_eligible_product_company(uuid)`.

- [ ] **Step 1: Verify existing suite baseline (RED pre-check)**

Run: `npm test -- src/modules/adr` in `apps/carehub`
Expected: PASS (baseline green; record counts)

- [ ] **Step 2: Write migration + mirror (identical bodies)**

`adr_reports`: `report_source text NOT NULL DEFAULT 'unknown' CHECK (report_source IN ('public','health_facility','business_facility','unknown'))`; backfill existing non-NULL-`business_id` rows to `'business_facility'` where still `'unknown'`; `origin_channel_detail text`; `deadline_rule_version text`; `ALTER COLUMN business_id DROP NOT NULL` (widening only).
`business_aliases(alias_id, business_id FK CASCADE, alias, normalized_alias generated/lower-trim, is_approved DEFAULT false, created_at)`, UNIQUE(business_id, normalized_alias), INDEX(normalized_alias), RLS SELECT authenticated (name-only, no sensitive cols — table holds only names), INSERT/UPDATE/DELETE admin-only.
`adr_product_company_routes(route_id, report_id FK CASCADE, product_id FK CASCADE, responsible_business_id FK NULL, candidate_name text NULL, normalized_candidate text NULL, selection_kind CHECK ('verified','unknown','unverified_candidate'), status CHECK ('pending','verified','routed') DEFAULT 'pending', idempotency_key UNIQUE NOT NULL, verified_at/by, verification_notes, created_at)`, CHECK exactly-one-of (verified→business_id NOT NULL + candidate NULL; unknown→both NULL; unverified_candidate→candidate NOT NULL + business_id NULL), INDEXes (report_id, product_id, responsible_business_id+status).
`adr_report_events`: drop old CHECK, add CHECK with existing 4 + `routing_created|routing_verified|routing_routed|verification_recorded|history_linked`.
Helpers/RPCs (all `SET search_path=public`, REVOKE PUBLIC+anon / GRANT authenticated as per existing hardening; verify RPC restricted to `is_platform_admin()`):
`is_eligible_product_company(uuid)` → active + type in (`manufacturer_importer`,`wholesale`).
`create_adr_product_route(...)` SECURITY INVOKER: checks `can_access_adr_report`, product-belongs-to-report, kind/business/candidate coherence, eligibility; INSERT ... ON CONFLICT (idempotency_key) DO NOTHING → RETURN row; inserts `routing_created` event (DEFINER insert bypasses append-only RLS via owned function).
`verify_adr_product_route(route_id, notes)` SECURITY DEFINER: admin-only; sets `verified` (or `routed` when selection_kind=verified), stamps verifier, inserts `routing_verified` event.
`search_eligible_product_companies(query, lim)` SECURITY INVOKER: returns active eligible businesses (id, name, business_type, state, city) + approved aliases joined, ILIKE on name/normalized_alias, LIMIT clamp 1..50 default 20; no confidential columns.
RLS: ENABLE on both tables; routes SELECT `can_access_adr_report(report_id) OR (status='routed' AND responsible_business_id IN current_business_ids())` (platform admin covered inside helper); routes INSERT/UPDATE/DELETE via `can_access_adr_report(report_id)` (submitters/admins only — responsible companies cannot self-grant); aliases SELECT to authenticated, writes admin-only.
Analytics view: recreate with `+ r.report_source`, keep `security_invoker=true`.

- [ ] **Step 3: Self-review migration against Review Focus (5 lines above)**

Expected: each line answered in code (NULL-business admin-only falls out of existing row helper; eligibility enforced in RPC not RLS; idempotency via UNIQUE; candidate rows never satisfy `status='routed' AND responsible...` branch; existing rows backfilled not re-scoped).

- [ ] **Step 4: Re-run ADR suite**

Run: `npm test -- src/modules/adr` in `apps/carehub`
Expected: PASS, same counts as Step 1 (migration is additive; no JS behaviour changed yet)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/carehub_20261102_adr_routing_foundation.sql apps/carehub/sql/20261102_adr_routing_foundation.sql
git commit -m "feat(adr): phase1 routing foundation migration (source, aliases, per-product routes, search)"
```

### Task 2: JS routing helpers + repository methods + tests

**Files:**
- Create: `apps/carehub/src/modules/adr/routing.js`
- Create: `apps/carehub/src/modules/adr/routing.test.js`
- Modify: `apps/carehub/src/modules/adr/repositories/index.js` (append route/search methods only; no existing method changed)
- Test: `apps/carehub/src/modules/adr/routing.test.js`

**Interfaces:**
- Consumes: `ADR_MODULE_TYPES` (none else); repository `request` shape (`sbFetch`-compatible).
- Produces: `routing.js`: `PUBLIC_COMPANY_LABEL`, `REPORT_SOURCES`, `ROUTE_SELECTION_KINDS`, `ROUTE_STATUSES`, `buildIdempotencyKey({reportId,productId,kind,businessId,candidateName})`, `normalizeCompanyName(name)`, `validateRouteInput({reportId,productId,kind,businessId,candidateName}) -> {ok, error?}`, `isEligibleBusinessType(businessType)`; repository: `getProductRoutes(reportId)`, `createProductRoute({reportId,productId,...})`, `searchEligibleCompanies(query, limit)`.

- [ ] **Step 1: Write the failing test**

Tests (vitest, mirror existing style): label verbatim; sources exactly the 4 required; kinds exactly verified/unknown/unverified_candidate; idempotency key stable + distinguishes kind/business/candidate + normalizes candidate case/space; validateRouteInput rejects (missing ids, verified-without-business, verified-with-candidate, candidate-without-name, unknown-with-extras, non-uuid businessId); isEligibleBusinessType true only for `manufacturer_importer`/`wholesale`.
Run: `npm test -- src/modules/adr/routing.test.js` in `apps/carehub`
Expected: FAIL (module not defined)

- [ ] **Step 2: Implement `routing.js` to pass**

Pure functions only, no imports beyond types; `normalizeCompanyName` = trim + collapse spaces + lowercase (matches SQL normalized generation rule, documented).

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- src/modules/adr/routing.test.js`
Expected: PASS

- [ ] **Step 4: Add repository methods (thin wrappers, no behaviour change to existing)**

`getProductRoutes` → `adr_product_company_routes?report_id=eq...`; `createProductRoute` → `rpc/create_adr_product_route`; `searchEligibleCompanies` → `rpc/search_eligible_product_companies`. Extend `routing.test.js` with recording-adapter tests (mirroring `repositories/index.test.js` pattern) proving query shapes + idempotency key passthrough.

- [ ] **Step 5: Run full ADR suite + lint changed files**

Run: `npm test -- src/modules/adr`; `npx eslint src/modules/adr/routing.js src/modules/adr/routing.test.js src/modules/adr/repositories/index.js`
Expected: PASS, lint clean

- [ ] **Step 6: Commit**

```bash
git add apps/carehub/src/modules/adr/routing.js apps/carehub/src/modules/adr/routing.test.js apps/carehub/src/modules/adr/repositories/index.js
git commit -m "feat(adr): phase1 product-owner routing helpers and repository methods"
```

### Task 3: Docs + phase gate

**Files:**
- Create: `docs/architecture/ADR-Routing-Foundation.md`
- Modify: none (decision log lives in the doc)

**Interfaces:**
- Consumes: Tasks 1–2 outputs.
- Produces: architecture note (what changed, what is intentionally deferred: 3-state seriousness, deadline-rule engine, PV Tracker UI, public flow, historical linking procedure requiring admin verification).

- [ ] **Step 1: Write doc (change summary, RLS matrix delta, rollback, test evidence, unresolved regulatory items)**

- [ ] **Step 2: Full verification run**

Run: `npm test -- src/modules/adr` (record counts); `git status --short` (only intended files)
Expected: PASS; status shows plan + Task 1–3 files only

- [ ] **Step 3: Commit + stop for approval**

```bash
git add docs/architecture/ADR-Routing-Foundation.md docs/superpowers/plans/2026-10-15-adr-phase1-routing.md
git commit -m "docs(adr): phase1 routing foundation plan and architecture note"
```

Then STOP — report results, do not start Phase 2.
