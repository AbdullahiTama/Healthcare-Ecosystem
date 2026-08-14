# CareHub Ecosystem — Master Roadmap

Status: **living document**. Last consolidated: 2026-08-14. This replaces the old 4-line phase list with a roadmap grounded in what has actually been found and shipped across the engagement to date. It does not re-run discovery — that work already exists and is cited throughout. Read this document top to bottom once, then use it as an index: every claim below points at the file that proves it.

**This is "Strategy A" — incremental hardening of the current stack (Vite/React SPA, JS, hand-rolled data access, RLS as the primary boundary).** For a deliberately different strategy (Next.js, TypeScript, a server-enforced security boundary, and a revised UI/UX approach), see `planning/STRATEGY_B_NEXTJS_TYPESCRIPT.md` — the two documents are meant to be read together; that one ends with an explicit recommendation on what to adopt from it now versus later.

**No code changes were made producing this document.** Per `.claude/CLAUDE.md`'s Development Order (Understand → Analyze → Plan → Review Plan → Implement...), this is the Plan artifact — Section 51 ("Output Required Before Major Implementation") of the engineering brief this roadmap answers to.

---

## 0. How to navigate this project's documentation (read this first)

This repository is not undocumented — it has more planning infrastructure than most production SaaS codebases. The failure mode here is duplicating it, not lacking it.

| If you need... | Read |
|---|---|
| What the product is, who it's for | `docs/PROJECT_OVERVIEW.md`, `README.md`, `knowledge/business/` |
| Current architecture, as-built | `architecture/Current-Architecture.md` (a full onboarding-grade audit), `architecture/Ecosystem-Overview.md` |
| Live database schema (both apps) | `architecture/Schema-Reference-CareHub.md`, `architecture/Schema-Reference-CareFind.md` |
| Every open bug/vuln/debt item, prioritized | `planning/CODE_AUDIT.md` (Critical/High/Medium/Low, actively maintained), `architecture/Technical-Debt.md` (C#/H# reference numbers with effort+risk) |
| Security posture, what's fixed vs. open | `planning/REMEDIATION-STATUS.md` (kept current after every session), `architecture/Security-Risks.md`, `architecture/Authentication.md` |
| A specific business module's behavior | `knowledge/modules/*.md` (38 files — pharmacy, POS, inventory, hospital pipeline, wallet, etc.) |
| An architectural decision and why | `decisions/ADR/*.md` (001–005: care-ecosystem shape, branch isolation, shared clients/debts, master catalog, consultation payments) |
| The design system (tokens, components, patterns) | `docs/design/*.md` (18 files) — DESIGN_SYSTEM, COMPONENT_LIBRARY, SCREEN_PATTERNS, ACCESSIBILITY, RESPONSIVENESS |
| Repository-seam refactor progress | `planning/SESSION-STATE-20260804.md` + the "Refactoring" section of `planning/CODE_AUDIT.md` |

**Rule going forward: before writing a new doc, grep for whether one already exists.** This project has been burned before by parallel/stale versions of the same document (`docs/discovery/*` vs `architecture/*` partially overlap — `architecture/` is the newer, higher-confidence set and should be treated as canonical where they conflict).

---

## 1. Executive Assessment

**Overall health: a real product with real revenue-adjacent workflows (POS, wallet, payments), under active, disciplined remediation — not a prototype, not abandoned technical debt.** The engineering process already matches the brief's own philosophy (incremental fixes, verified against live state, one commit per unit, AskUserQuestion before anything hard-to-reverse) more closely than most codebases that receive this kind of audit.

What's unusual and worth stating plainly:
- **Every Critical/Severe finding discovered to date has been fixed and verified in production**, not just documented (`planning/CODE_AUDIT.md` Critical section: C20, C2, C19, C18, C17, C15, C14, C5, C16 all closed with behavioral proof, not just a migration that ran). The one recurring lesson this project has learned the hard way, three separate times, is: **a DDL statement completing is not evidence it did anything** — `CREATE OR REPLACE` doesn't drop a differently-signed sibling, `REVOKE FROM PUBLIC` doesn't touch direct role grants, `DROP POLICY IF EXISTS` on a wrong name is a silent no-op. This is now a standing verification habit (`reference-supabase-carehub-gotchas` memory / `architecture/Security-Risks.md`), and any new engineer must internalize it before touching RLS or SECURITY DEFINER functions here.
- **Two structurally different applications share one database and diverge in architecture, auth model, and code organization** (`architecture/Current-Architecture.md` §2, §4). CareHub is an operational SaaS (retail idioms bolted onto later clinical modules); CareFind is majority a social/live-streaming/creator-monetization platform with a minority "healthcare discovery" surface. This is not a defect to fix by unifying them — see §4 (Target Architecture) — but it is the single fact that should shape every future architectural decision.
- **The repository-seam architecture migration (Phase 3 of this roadmap) is 16 of 24 CareHub modules complete**, and has independently found a real bug in *every single module it has touched* — unscoped writes, missing tenant filters, non-atomic transfers (`project-carehub-repository-seam` memory; `planning/CODE_AUDIT.md` "Refactoring" section). This is strong evidence the remaining 8 modules (`consultation` next, then `pos`/`stock` residuals, then the rest) contain undiscovered defects of the same shape, not that the codebase has "already been swept."
- **The biggest gap is not security or architecture — it is process infrastructure.** There is no CI/CD, no tracked migration history (SQL lives as 64 loose files across `apps/carehub/sql/` + `apps/carefind/sql/`, not a `supabase/migrations` directory Supabase's own tooling understands), and testing exists only for CareHub's newly-migrated modules + CareFind's UI. See §5.

**Bottom line: do not restart the security/architecture work — continue it (§7, Phase 1–3 status). Start the process/DevOps work that has never been started (§7, Phase 6–7) in parallel, since it is what will let this progress survive a change of engineer or a bad week.**

---

## 2. Product Summary

*(Condensed from `docs/PROJECT_OVERVIEW.md` and `architecture/Ecosystem-Overview.md`; read those for full detail.)*

- **CareHub** — internal, multi-tenant SaaS for healthcare businesses (pharmacy, hospital, laboratory, imaging, wholesale/enterprise verticals). POS, inventory, staff, appointments, hospital clinical pipeline (Reception → Triage → Doctor → Lab/Imaging/Pharmacy), consultations, purchasing, requisitions, debts, expenses, reporting, subscription/plan management.
- **CareFind** — public-facing discovery + social platform. Provider/medicine search, business profiles, reviews, appointment booking, and (the majority of its actual code) a social feed, live-streaming, creator monetization/gifting, and a CareCoin wallet.
- **Shared infrastructure**: one Supabase Postgres project (`carehub` / `szdybxmgmhndoytqanfb`, `eu-west-1`), two independent Vite/React 18 SPAs, two independent Vercel deployments, a handful of `@care-ecosystem/*` shared npm packages (`shared-marketplace`, `shared-notifications`).
- **Real cross-product bridges** (not aspirational): `staff_claims` (CareFind users claiming a CareHub staff identity, approved in CareHub), `business_claims` (claiming business ownership, approved in CareFind admin), CareFind-originated appointment bookings landing in CareHub's `appointments` table, and CareFind's professional-consultation payment flow debiting/crediting CareHub-adjacent wallets.

---

## 3. Current State Assessment (by area)

Each of these has a dedicated document; this is the rollup, not a replacement.

| Area | State | Primary source |
|---|---|---|
| **Security / Auth** | Real Supabase Auth sessions for both products; plaintext password columns fully purged (C2, 2026-08-13); RLS live on all ~90 tables across both products, verified behaviorally (not just by policy count) after two regressions (C14, C19) taught the project not to trust catalog state alone. `admin_users`/`admin_teams` policy cleanup still open. | `planning/REMEDIATION-STATUS.md`, `architecture/Security-Risks.md`, `architecture/Authentication.md` |
| **Multi-tenancy** | `business_id`-scoped RLS is the standard; several aggregates have non-uniform tenancy within themselves (`rep_territories`, `staff_claims` — no direct tenant column, scoped via parent) and this is now a documented, checked-per-table pattern rather than an assumption. | `architecture/Technical-Debt.md` C1/C14/C19; `project-carehub-repository-seam` findings |
| **Database schema mgmt** | **No formal migration tooling.** 64 `.sql` files live as loose, hand-applied scripts (`apps/carehub/sql/`, `apps/carefind/sql/`), several explicitly marked "not yet applied" in `CODE_AUDIT.md`. No `supabase/migrations` directory, no CLI-tracked history beyond what Supabase's own `supabase_migrations.schema_migrations` records for migrations applied via the MCP tool. This is the single largest structural gap — see §7 Phase 2/6. | `planning/CODE_AUDIT.md` Medium section; `sql/` directory listing |
| **Transactional integrity** | Fixed where found: atomic stock transfer/adjust (`transfer_stock_batch`/`adjust_stock_batch`, row-locked), atomic sale stock decrement (trigger-based), atomic wallet crediting (`credit_wallet_topup`, reference-uniqueness-guarded). Two known-open gaps: stock backfill was deliberately not attempted (historical data unreliable), and `stock_movements` is written but never read (dead audit trail, needs a product call). | `architecture/Technical-Debt.md` C5/C11/C12/C15/C17 |
| **Repository/domain layer** | In progress, not complete. 16/24 CareHub modules off the shared `services/supabase.js` monolith onto per-module repositories with an injected transport seam (real PostgREST in prod, in-memory adapter in tests). CareFind has no equivalent layer yet — its business logic is still largely in page components. | `project-carehub-repository-seam` memory; `planning/SESSION-STATE-20260804.md` |
| **Frontend architecture** | Two React 18 + Vite SPAs, no shared design-system package (CareHub and CareFind each have their own `components/ui`), no client-side data-fetching/caching layer (no React Query/SWR — every screen fetches on mount), no route-level code splitting beyond one lazy-loaded admin panel. CareHub build is >1.4MB minified single chunk. | `architecture/Current-Architecture.md` §3/§5/§9; `planning/CODE_AUDIT.md` Performance |
| **Design system / UX** | CareHub: **100% complete** — every screen (retail, hospital pipeline, enterprise verticals) rebuilt to one design language, lucide icons, no gradients, tokenized colors, verified responsive at 375/768/1280. CareFind: **complete for every reachable screen** per the last verified pass, though the most recent session flagged a lost-and-redone incident (recovered) and some post-auth screens as not re-verified since. | `project-carehub-design-refresh` memory; `docs/design/*.md` |
| **Testing** | CareHub: Vitest, 288 tests, concentrated on migrated repository modules (unmigrated modules and most UI have zero coverage). CareFind: Vitest + Testing Library, 208 tests, mostly UI/component-level. **No E2E tests. No security regression suite beyond ad hoc verification scripts embedded in SQL migration files.** | `apps/carehub/package.json`, `apps/carefind/package.json`, test counts per `REMEDIATION-STATUS.md`/`CODE_AUDIT.md` |
| **CI/CD** | **None.** No `.github/workflows`, no lint/test/build gate on PRs, no automated migration validation. Two independent `vercel.json` deploys per app, deployed manually/on push with no quality gate. | Confirmed via repo scan |
| **Observability** | None beyond Supabase's own dashboard (logs, advisors) and manual `get_advisors` security baselines taken before/after risky DDL. No application error tracking, no structured logging, no uptime/perf monitoring. | Confirmed via repo scan |
| **Documentation** | Unusually strong for architecture/security/design/domain knowledge (see §0). Weak on **operational** docs: no `DEPLOYMENT.md`, no `.env.example`, no `INCIDENT-RESPONSE.md`, no `TESTING-STRATEGY.md` as a standalone doc (testing knowledge is scattered across session memory and audit entries). | Gap — not yet written |

---

## 4. Target Architecture

**Do not restructure into `apps/`/`packages/` — you are already there.** The repo already matches the master brief's target shape at the top level:

```
HealthCare-Ecosystem/
├── apps/
│   ├── carehub/         ✅ modular-ish (pages/, components/, lib/, modules/{seam-migrated})
│   └── carefind/        ⚠️ flatter, less modularized than carehub
├── packages/
│   ├── shared-marketplace/     ✅ exists, in use
│   └── shared-notifications/   ✅ exists, in use
├── docs/, architecture/, decisions/, knowledge/, planning/   ✅ all exist, actively maintained
```

**What target architecture actually means here, concretely, is finishing three already-started migrations rather than starting a new one:**

1. **CareHub: finish the repository-seam rollout** (8 remaining modules: `consultation` next per the documented plan, then close the `pos`/`stock` cross-aggregate residuals, then the rest). This *is* the "domain layer" the brief calls for — `UI → repository (application/domain) → sbFetch transport (infrastructure)` — already proven out on 16 modules with two testable adapters per repository. Do not invent a parallel pattern; extend this one.
2. **CareFind: adopt the same seam.** It currently has none — `AdminPanel.jsx` alone is 1,868 lines mixing data access, business logic, and presentation. This is real, not cosmetic, technical debt: it is why C10/C13/C14/C19-shaped bugs kept surfacing there specifically. Candidate order: start with the admin-write surface (already partially centralized behind `api/admin-auth.js` from the H11/C9 security work — that *is* half of a service layer already), then the wallet/gifting aggregate (highest financial risk), then social feed.
3. **Database schema as code**: adopt Supabase CLI's local migration workflow (`supabase/migrations/`) so every `.sql` file currently sitting loose in `apps/*/sql/` gets a tracked, ordered, reproducible history, and new changes go through `supabase db diff` / `supabase migration new` instead of hand-written files applied ad hoc. This directly closes the biggest gap in §3 and is a **prerequisite for CI/CD** (§7 Phase 6) — you cannot gate a PR on "does this migration apply cleanly" without migrations being a defined, ordered set.

**What NOT to do**, per the brief's own constraints and this project's demonstrated needs:
- Do not merge CareHub and CareFind into one app or one auth model — their user bases, security postures, and even their *product categories* (operational SaaS vs. social/creator platform) are genuinely different, and the one place they've tried to share more than data (the `consultations` table collision, C8) caused a multi-week-hidden bug.
- Do not introduce microservices, a queue, or a service mesh — nothing in this codebase's actual load or team size justifies it, and the brief explicitly warns against it.
- Do not adopt a new frontend framework or state-management library speculatively. The gap is caching/fetching (see §5), not the framework.

---

## 5. Stack, Frameworks, and Resources

Grounded in what's already chosen and working (don't replace working tools) plus the specific, evidenced gaps from §3. Each recommendation states what problem it closes, referencing the finding that justifies it.

### 5.1 Keep as-is (working, don't relitigate)
| Layer | Current choice | Why keep it |
|---|---|---|
| Frontend framework | React 18 + Vite 5 (both apps) | Fast dev loop, no evidence it's a bottleneck; migrating frameworks would be pure risk for zero benefit |
| Backend/data | Supabase (Postgres 17 + PostgREST + Auth + Storage + Realtime) | RLS-based multi-tenancy is now genuinely working and battle-tested here (§3); replacing it would throw away months of hardening |
| Test runner | Vitest (+ Testing Library for CareFind) | Already integrated, fast, consistent with Vite |
| Styling | Inline `style={}` objects against a shared `theme` token module | Not fashionable, but consistent (`docs/design/DESIGN_SYSTEM.md`) and the design-refresh work already standardized every screen on it — a CSS-in-JS or Tailwind migration now would be a large, purely cosmetic-risk refactor with no functional benefit |
| Icons | `lucide-react` | Fully rolled out, zero emoji left in either product's user-facing UI |
| Payments | Paystack (webhook + redirect-verify pattern) | Correctly hardened (HMAC verification, idempotency via partial unique indexes) after C15 |

### 5.2 Fill (real, evidenced gaps — in priority order)

| Gap | Recommendation | Closes |
|---|---|---|
| **No CI/CD** | GitHub Actions: `lint → test → build` per app on every PR, minimum viable version first (see Phase 6). Do not build a 10-stage pipeline day one — two working jobs (`carehub-ci.yml`, `carefind-ci.yml`) beat one elaborate unstarted one. | §3 CI/CD row; brief §40 |
| **No migration tracking** | Supabase CLI (`supabase migration new`, `supabase db diff`, `supabase db push` against a local shadow DB) to formalize `apps/*/sql/*.sql` into `supabase/migrations/`. This is tooling around the *existing* SQL, not new infrastructure. | §3 schema-mgmt row; the recurring "DDL completing ≠ applied correctly" lesson |
| **No error tracking / observability** | A lightweight error-tracking SaaS (Sentry's free/small tier is the standard choice for a Vite+React+Vercel stack and has first-party integration for both) on both frontends and the Vercel serverless functions (`api/*.js`). This is the cheapest way to close the "silent breakage" pattern that produced C13, H10, and the out-of-stock/requisition bugs — those were all found by manual code reading, not by anything telling the team a request was failing. | §3 Observability row; brief §41 |
| **No data-fetching/caching layer** | TanStack Query (React Query) — introduce incrementally, starting with the highest-traffic screens (Dashboard, POS product list) rather than a blanket rewrite. Addresses "every navigation refetches from scratch" (`architecture/Current-Architecture.md` §5) and the 1000-row PostgREST clamp class of bug (`pagedQuery.js` already exists as a manual workaround — React Query wouldn't replace pagination logic, but would stop redundant refetches). **Low priority relative to CI/CD and migrations** — this is a performance/UX improvement, not a correctness or security gap. | §3 Frontend row |
| **No E2E tests** | Playwright, scoped initially to the journeys the brief itself names as critical (registration → login → first sale; requisition create → approve; debt settlement) rather than full coverage on day one. | §3 Testing row; brief §39 |
| **No `.env.example` / operational docs** | Write `docs/operations/DEPLOYMENT.md` and `.env.example` per app — near-zero effort, closes L6 in `Technical-Debt.md`. | §3 Documentation row |

### 5.3 Explicitly do not add
- No TypeScript migration as a blanket initiative — the codebase is large and untyped, and a partial migration creates exactly the two-dialect confusion the brief warns against (§43). If type safety becomes a priority, scope it to new modules only (e.g., the next repository-seam migrations), never a repo-wide conversion.
- No microservices, message queue, or service mesh (brief §2, explicit).
- No second state-management library — React Query (above) covers server state; local UI state is already handled adequately by `useState`/Context.
- No new UI component library (MUI, Chakra, etc.) — the hand-rolled design system is complete and consistent; swapping it now would undo the entire design-refresh effort for no functional gain.

---

## 6. Priority Model

Using the brief's P0–P3 scale, mapped onto what's actually open right now (not historical — closed items are excluded; see `planning/CODE_AUDIT.md` for the full historical record).

### P0 — Critical (fix before anything else)
1. **Master catalog migrations not applied** (`20260810_master_catalog.sql`, `20260811_master_catalog_ops.sql`) — a shipped UI (Master Catalog page, branch-clone RPC) is calling database objects that don't exist yet in production. Zero-risk to apply (0 rows affected), high risk to leave (silent 404s / degraded branch creation). → `CODE_AUDIT.md` Medium.
2. **Demand/requisition save is broken live** — schema drift between a hand-rolled `out_of_stock` table and what the app writes; fix is written (`20260811_align_out_of_stock_schema.sql`) but not applied. → `CODE_AUDIT.md` Critical (open item).
3. **`admin_users`/`admin_teams` RLS cleanup** — flagged repeatedly (C9, C14) as needing its own careful pass, never done. This is the last known table-level hole of the shape that produced C19. → `Technical-Debt.md` C14.
4. **Five other draft migrations sitting unapplied** (`professional_consultations`, `backfill_confirmed_auth_users`, `roles_rls`, `booking_config` — see `REMEDIATION-STATUS.md` "Blocked on you" #5) — each has a real, currently-broken or currently-insecure feature behind it.

### P1 — High
- Finish the repository-seam rollout (8 CareHub modules remaining) — every module migrated so far has surfaced a real defect; the unmigrated ones are unaudited by construction.
- `stock_movements` product decision (build the read view or stop writing the journal) — half-built audit trail, needs a call, not more code.
- Formalize migrations as code (§4.3) — blocks safe CI/CD.
- Stand up minimum-viable CI (lint+test+build gate) — currently nothing stops a broken build from merging.
- CareFind repository-seam adoption, starting with the admin/wallet surface.

### P2 — Medium
- Error tracking (Sentry or equivalent) on both apps + serverless functions.
- Route-level code splitting for CareHub's >1.4MB bundle.
- Server-side pagination for the remaining unpaged list queries (`saleRepository.getToday/getAll`, expense reads, `getBusinesses`, `getBranches` — same clamp class already fixed for products/clients).
- React Query adoption on highest-traffic screens.
- Consolidate CareHub's `BusinessDashboard.jsx` local toast implementation into the shared `ToastProvider`.

### P3 — Low
- Stray artifacts (dead code, stale branding in emails, `L1`–`L4` in `Technical-Debt.md`).
- Cosmetic follow-ups already identified but deliberately deferred (e.g. `PRODUCT_EMOJIS` unused-but-referenced field).

---

## 7. Phased Roadmap

Status reflects reality as of 2026-08-14, not aspiration. Phases run partially in parallel where they don't share a bottleneck — this is not strictly sequential.

| Phase | Scope | Status |
|---|---|---|
| **0 — Discovery** | Architecture map, dependency map, DB map, security map, tech-debt inventory | ✅ **Done.** 15 architecture docs, 38 module docs, full schema reference for both products, live-verified. Maintain, don't redo. |
| **1 — Critical Security** | Auth rebuild, RLS, privileged-field protection, secret hygiene | 🟡 **Mostly done, not closed.** Real sessions + RLS live on all tables for both products; plaintext passwords purged. Open: `admin_users`/`admin_teams` policy pass (P0 #3 above), Paystack secret key still a placeholder in `apps/carehub/.env` per `CODE_AUDIT.md`. |
| **2 — Data Integrity** | Transactional workflows, inventory, financial correctness | 🟡 **Mostly done for what's been touched.** Stock transfer/adjust/sale-decrement, wallet crediting all atomic and verified. Open: unapplied migrations (P0 #1/#2/#4), no formal migration tooling (§4.3). |
| **3 — Architecture** | Repository/domain layer, validation, standard error handling | 🟡 **16/24 CareHub modules done; CareFind not started.** Continue per §4 — do not restart, do not invent a second pattern. |
| **4 — Design System** | Tokens, components, navigation, forms, tables, feedback states | ✅ **CareHub 100% done.** ✅ CareFind done for every screen verified; a handful of post-auth screens flagged as not re-verified after a recovery incident — worth a quick re-check, not a redo. |
| **5 — UX Transformation** | Onboarding, dashboards, role-aware experience, responsiveness, accessibility | 🟡 **Partially covered as a side effect of Phase 4** (every screen verified responsive at 3 breakpoints during the design refresh). Not yet done as a deliberate pass: onboarding flow review, dashboard "what needs my attention" redesign (brief §22), global search/command palette (brief §24). |
| **6 — Testing & CI/CD** | Unit/integration/E2E, security regression tests, GitHub Actions | 🔴 **Largest gap.** Unit tests exist but partial; zero E2E; zero CI. Start here in parallel with Phase 3, per §5.2 priority order — minimum-viable CI first, formalized migrations second, E2E on named critical journeys third. |
| **7 — Observability** | Error tracking, structured logging, DB health | 🔴 **Not started.** No tool chosen yet — see §5.2. |
| **8 — Scale & Optimize** | Perf, caching, background jobs | ⚪ **Not yet warranted.** No measured performance problem beyond the known bundle-size and unpaged-query items already tracked in P2. Do not start this phase speculatively — the brief is explicit that this phase only begins after measurement, and no measurement has motivated it yet beyond what's already in P2. |

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| An unapplied "draft" migration is assumed applied by a future session (recurring failure mode: C16, the master-catalog gate, the requisition schema drift) | High — has happened repeatedly | Data corruption or silent feature breakage | Formalize migrations as code (§4.3) so "applied" is a queryable fact, not a memory/doc claim. Until then: every session must re-verify `supabase_migrations.schema_migrations` / `information_schema` before trusting a doc's "applied" claim — this is already the working practice (see `reference-supabase-carehub-gotchas`), keep enforcing it. |
| Continuing the repository-seam migration surfaces another cross-tenant write bug in an unmigrated module (statistically likely — every module so far has had one) | High | Data leak or corruption in production before it's caught | This is an argument *for* finishing Phase 3 quickly, not a reason to slow down. Prioritize modules with financial/clinical data (`consultation` is next per the existing plan — correct choice). |
| No CI means a broken build or a regression reaches production undetected | Medium-high, compounding as team/change velocity grows | User-facing breakage, no safety net | Phase 6, P1 priority. Even a single lint+test+build gate closes most of this. |
| CareFind's lack of a repository/service layer means the next security finding there (pattern: C10, C13, C14, C19 all originated in scattered, un-abstracted CareFind data access) is undiscovered right now | Medium-high | Same shape as prior Critical findings | Start CareFind's repository-seam adoption (§4 item 2) rather than treating CareHub's progress as "the architecture work is handled." |
| Two-app / two-auth-model split diverges further as CareFind grows its social/creator features, making a future genuine integration harder | Medium | Increased long-term maintenance cost, not urgent | Accept the split (§4) — don't force convergence. Revisit only if a specific integration need arises (as `staff_claims`/`business_claims` did organically and successfully). |
| Vercel deploys have no gate — a `git push` can go straight to production | Medium | Same as CI risk, but at deploy time specifically | Add a required-checks rule once CI exists (Phase 6), or at minimum a preview-deploy review step before promoting to production. |

---

## 9. Definition of Done (per module, going forward)

Applies to every module migrated under Phase 3 and every new feature from this point forward — matches the brief's §56 verbatim, restated as a checklist so it's actionable:

- [ ] Data access goes through a repository with an injected transport (not `services/supabase.js` directly)
- [ ] Every write scoped by `business_id` (or documented reason it can't be — e.g. `staff_claims`, `rep_territories`)
- [ ] RLS policy verified behaviorally (impersonation probe), not just "a policy exists"
- [ ] Loading, error, and empty states present
- [ ] Verified responsive at 375/768/1280
- [ ] Test coverage for the repository (in-memory adapter) at minimum; UI test where behavior is non-trivial
- [ ] No native `alert()`/`confirm()`/`prompt()` (project standard since the 2026-07-19 sweep)
- [ ] Commit discipline: refactor and behavior-fix are separate commits (`feedback-carehub-commit-discipline`)
- [ ] `CODE_AUDIT.md` / `Technical-Debt.md` updated if the work closes or discovers a tracked item

---

## 10. Immediate Next Actions

In order, each independently actionable:

1. **Apply the queued-but-unapplied migrations** (P0, §6) — this is the highest ratio of risk-closed to effort-spent available right now. Needs your explicit go-ahead per this project's established pattern (every production DDL has been gated on that so far — keep it that way).
2. **Stand up minimum-viable CI** (lint + `vitest run` + `vite build` per app, GitHub Actions, two files) — small, mechanical, and closes the biggest process gap.
3. **Resume the repository-seam rollout at `consultation`** (already the documented next unit) — continues momentum on the workstream with the best track record for finding real bugs.
4. **Write `docs/operations/DEPLOYMENT.md` + `.env.example` per app** — near-zero effort, removes "tribal knowledge required to deploy" risk.
5. **Schedule the `admin_users`/`admin_teams` RLS pass** — the last known table-level hole of a previously-critical shape; do it deliberately rather than waiting for it to surface as an incidental finding like C18/C19 did.

None of these require architectural debate — they're the next concrete steps on workstreams already validated by this engagement's own track record.
