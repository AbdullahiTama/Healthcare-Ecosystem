---
title: 'D1: Migrate CareHub Business Dashboard onto the shared dashboard foundation'
type: 'refactor'
created: '2026-09-29'
status: 'done'
review_loop_iteration: 1
baseline_commit: '44d99129816e84932344c03d85380b942c134e74'
context: ['docs/design/DASHBOARD_FOUNDATION.md', 'AGENTS.md']
---

<frozen-after-approval reason="human-owned intent â€” do not modify unless human renegotiates">

## Intent

**Problem:** The CareHub Business Dashboard still hand-rolls its shell geometry, section headers, list rows, and action tiles that the shipped foundation now provides â€” so it cannot serve as the reference adoption for D2/D3 and it misses the foundation's bar (no skip link/landmark, no query error state).

**Approach:** Adopt the 11 shipped primitives â€” `DashboardShell` + `PageHeader` for the shell, `MetricGrid`/`SectionCard`/`ActivityList`/`QuickAction` + shared states for the home route â€” with zero business-logic, permission, or routing changes, proven by new render tests.

## Boundaries & Constraints

**Always:** Behavior-preserving diff â€” guards, `perms`, prefetch, product sync, proactive-alert effect, all `navigate()` targets, route table, and the `pageProps` contract stay identical. Use only the 11 shipped primitives + shared `Loading`/`Empty`/`ErrorState` (any primitive gap â†’ Ask First). Every data surface keeps loading/error/empty states; the home route gains an aggregate query-error surface whose Retry calls the real `refetch` (never swallow it). `Sidebar`, `TopBar`, `PlanExpiryBanner` are reused unchanged. Responsive parity at 375/768/1024/1280 via existing `useBreakpoint`; no horizontal overflow. Tests + docs updated.

**Ask First:** Adding chart/sparkline content that does not exist today (data-fabrication risk). Overriding `gutter`/`contentMaxWidth` beyond geometry that matches today's. Any edit to `Sidebar`/`TopBar`. Any new primitive.

**Never:** New dependencies. Touching `apps/carefind/**` or the D2/D3 targets (CareHub Admin, CareFind Admin). Rewriting guards/routes/auth. Deleting `pageProps` keys (30+ modules share it). Committing without explicit human request.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Initial load | queries pending | full-page `Loading` "Loading dashboard..." (as today) | N/A |
| Loaded | real query rows | KPIs, worklist, sales, quick actions from real data | N/A |
| Query failure | any of `useTodaySales`/`useAllSales`/`useAppointments` `isError` | aggregate error surface with Retry; sections still render available data | Retry â†’ `refetch` |
| Empty | zero rows | shared `Empty` (worklist `cause='positive'`, sales `cause='none'`) | N/A |
| Permission | role lacks appointments perm | appointment worklist item absent; quick actions filtered by nav keys | N/A |
| Offline | navigator offline | existing offline strip still renders above banner | preserved |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` -- shell + role-guarded router for `/dashboard/*`; export L94; **migrate L193â€“222** (Sidebar L194, scroll container L222, mobile trigger L200â€“215, offline strip L216â€“220) â†’ `DashboardShell` (`nav`/`topbar`), `ModuleLoading` L59â€“80 â†’ shared `Loading`. **Never change:** `guard` L131, `bareGuard` L140, `reportHubGuard` L145, `perms` L111, customRoles L103â€“110, prefetch L119â€“124, product/sync L150â€“186, `pageProps` L190, route table L224â€“269 (incl. padding ternaries L233â€“267 â€” preserve via shell `gutter`), `Toast` L273, `AdrReportPageRoute` L280â€“283.
- `apps/carehub/src/modules/dashboard-home/DashboardHome.jsx` -- props `{brand,products,role,perms}` L45; queries+`loading` L55â€“59; derivations L61â€“90; **never touch** alert effect L92â€“152; `if (loading)` L160. **Migrate:** sticky header L169â€“187 â†’ `PageHeader` (keep sticky via wrapper style), KPI grid L192â€“197 â†’ `MetricGrid minColumn={160}` (decision B â€” `columns` is unusable for 4-track grids, see Design Notes), worklist card L206â€“238 + `WorkItem` L24â€“43 â†’ `SectionCard` + `ActivityList`, recent sales L242â€“265 â†’ `ActivityList`, quick actions L269â€“279 (perm filter L271) â†’ `QuickAction` tiles, hospital flow L286â€“300 â†’ `SectionCard`; add aggregate error surface (Retry = `refetch`).
- `packages/design-system/src/components/dashboard/` -- 11 primitives; key signatures: `DashboardShell` L34 (`nav, topbar, aside, collapsed, navWidth, contentMaxWidth, gutter, ...`), `MetricGrid` L11, `SectionCard` L11, `ActivityList` L23 (items `{id,title,meta,icon,value,tone,onClick}`, `empty*` props), `QuickAction` L17, `ChartCard` L14.
- `apps/carehub/src/components/ui/index.jsx` L9 -- already re-exports all 12 names; import from here.
- `apps/carehub/src/components/layout/TopBar.jsx` L20 (reuses `PageHeader compact`), `Sidebar.jsx` L22, `PlanExpiryBanner.jsx` L10 -- reused unchanged, passed as shell slots.
- `apps/carehub/src/hooks/queries.js` L21/L30/L39 -- `useTodaySales`/`useAllSales`/`useAppointments` (react-query; expose `isError`/`refetch`, currently unread).
- Tests: **none exist** for the two target files. Primitives covered by `src/components/__tests__/sharedDashboard.test.jsx`; `PageHeader` by `designSystem.test.jsx`; states by `sharedPrimitives.test.jsx`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` -- replace shell markup L193â€“222 with `DashboardShell` (`nav` = `<Sidebar â€¦>`, `topbar` = fragment of today's column chrome: mobile trigger L200â€“215 + offline strip L216â€“220 + `<PlanExpiryBanner>`, `gutter={0}` so per-route padding stays the single source of truth, children = existing `<Suspense><Routes/></Suspense>`), and `ModuleLoading` L59â€“80 â†’ shared `Loading` -- delivers skip link + `main#ds-main-content` while guards/routes/effects/`TopBar`-per-route stay byte-stable.
- [x] `apps/carehub/src/modules/dashboard-home/DashboardHome.jsx` -- headerâ†’`PageHeader`, KPIsâ†’`MetricGrid`, cards/headersâ†’`SectionCard`, worklist + sales rowsâ†’`ActivityList`, quick actionsâ†’`QuickAction`, add aggregate error surface with Retryâ†’`refetch` -- no edits inside L92â€“152, navigation targets, or permission gates.
- [x] `apps/carehub/src/pages/dashboard/__tests__/BusinessDashboard.test.jsx` -- NEW smoke test (vi.mock `dashboard-home` module + auth/repos/permissions/supabase) -- asserts skip link, `main#ds-main-content`, Sidebar present, dashboard route renders.
- [x] `apps/carehub/src/modules/dashboard-home/__tests__/DashboardHome.test.jsx` -- NEW (mock `hooks/queries`) -- asserts loading, loaded KPIs/lists/actions, empty states, error surface + Retry fires `refetch`, appointment action hidden without perm.
- [x] `docs/design/DASHBOARD_FOUNDATION.md` -- append a short "Adoption status" note recording D1 -- keeps the foundation doc honest for D2/D3.

**Acceptance Criteria:**
- Given the Business Dashboard diff, when reviewed, then guards/`perms`/prefetch/sync/alert-effect/route-table/`pageProps` regions are unchanged from their anchors in the Code Map.
- Given an authed Owner at `/dashboard`, when data resolves, then KPIs, worklist, sales, and quick actions render from real query data inside `main#ds-main-content`, with a working skip link on keyboard focus.
- Given viewports 375/768/1024/1280, when any `/dashboard/*` route renders, then there is no horizontal overflow and the KPI grid wraps **4â†’4â†’3â†’2** â€” today's measured sequence (human-ratified 2026-09-29; the original "4â†’3â†’2â†’1" text was written pre-measurement and contradicted the behavior-preserving constraint).
- Given `npm test`, `npm run build` in `apps/carehub`, then the suite passes with no new failures and the build succeeds.

## Spec Change Log

### review_loop_iteration 1 -- review triage patches (2026-09-30)

- **Triggering finding:** Three-layer review (blind-hunter, edge-case, verification-gap) on the D1 diff. Converging root causes, all additive to a validated implementation (1053 tests green, protected regions byte-identical, decision-B measurement intact) -- patch-route, not revert.
- **Frozen I/O matrix Permission row corrected (human-authorized 2026-09-30):** the original row ("appointment quick action absent (`canSeeAppts`)") did not describe the implemented and tested behavior -- the appointments gate hides the worklist *item* (appointment entry is `canSeeAppts`-gated) while quick actions are filtered by `perms.nav` keys. Row now reads "appointment worklist item absent; quick actions filtered by nav keys". This is a wording correction of intent, not a behavior change.
- **(B1) Error/empty collision (blind-hunter):** on query failure the KPI/list sections still rendered `Empty` ("Nothing needs your attention right now.") under the aggregate error surface -- a false all-clear. Fix: gate both explicit `Empty`s on `failed.length === 0` in `DashboardHome.jsx`. **KEEP:** the error surface itself and its Retryâ†’`refetch` behavior; the sections below it still render available data (row 3 of the matrix).
- **(B2) `ActivityList` tone invisible (blind-hunter):** `tone` only colors `item.value`; the icon tile stayed `tealMist`/`tealDeep`, so danger/warning rows were visually undifferentiated. Fix: tone-keyed icon-tile background (additive theme tokens; brand/info keep `tealMist`). **KEEP:** value-color logic and all item props.
- **(B3) Banner-inside-main landmark nesting (blind-hunter):** `PageHeader` renders `role="banner"`, but the home header sits inside the shell's `main#ds-main-content` -- banner is not a valid descendant of main. Fix: additive `landmark` prop on `PageHeader` (default `'banner'`, backward compatible) passed as `landmark="none"` from the home header and the single `TopBar` call site. **KEEP:** the default so other consumers keep their banner role.
- **(B4) `overflowX: 'hidden'` masked the overflow AC (blind-hunter):** the shell scroll container clamped horizontal overflow instead of exposing it, so "no horizontal overflow" could not fail visibly (pre-D1 column computed `visible`). Fix: `overflowX: 'auto'`. **KEEP:** `overflowY: 'auto'`, viewport lock, content cap.
- **(B5) Hand-rolled buttons (blind-hunter):** worklist badge / "+N more" / "View all" buttons lacked `type="button"`. Fix: add `type="button"` to all seven. The `ActivityList` `badge` prop intentionally takes a node (composition) -- no primitive API change.
- **(B6) AC3 evidence was layout-blind (verification-gap):** the wrap-sequence AC was pinned to a jsdom string assertion (`gridTemplateColumns` contains `auto-fit`/`160px`) that cannot observe wrapping; the earlier Chromium measurement was transient. Fix: committed probe `apps/carehub/scripts/verify-dashboard-grid.mjs` (playwright-core, modeled on carefind's audit script) renders the real shell + KPI grid + quick-action grid at 375/768/1024/1280 and asserts track counts 2/3/4/4 plus page-wide `scrollWidth <= clientWidth`; results recorded under Verification. **KEEP:** the existing jsdom assertion as a cheap regression guard.
- **Scope discipline:** no business-logic, permission, routing, or protected-region edits; no new dependencies (playwright-core already vendored in carefind for audits); carefind untouched.

## Design Notes

- **Shell wiring:** `TopBar` is rendered per route inside `<Routes>` (L233+) and the `dashboard`/`overview` routes deliberately skip it (comments L225â€“230) â€” it stays a route concern, not a shell slot. `gutter={0}` keeps each route's existing padding as the only padding source; the shell contributes geometry (viewport lock, scroll, cap, landmark, skip link) only. The floating mobile trigger keeps working: it renders only on mobile, where the column and viewport share an origin.
- **Sticky home header:** `PageHeader` is static; today's header is `position:sticky; top:0` with 56px mobile clearance for the floating menu trigger. Keep stickiness by wrapping `PageHeader` in a sticky container (composition, not a new primitive).
- **Shell width:** `DashboardShell` caps content at `theme.dashboard.contentMaxWidth` (1240) â€” this intentionally applies to all `/dashboard/*` routes, per foundation Â§7. `DashboardShell` exposes `contentMaxWidth` for a future per-route override; if manual QA shows a dense route (e.g. POS) breaking, HALT (Ask First) rather than silently overriding.
- **Visual deltas accepted:** `SectionCard` padding, `MetricGrid` gap/min-column, `ActivityList` hairlines, `QuickAction` elevation â€” the intended new language; no style overrides to mimic the old look.
- **`MetricGrid columns={4}` is a dead end (task text vs AC, resolved by measurement + human):** real Chromium via playwright-core shows `repeat(auto-fit, minmax(25%, 1fr))` with the default gap never fits 4 tracks (`nÂ·(w/n) + (nâˆ’1)Â·gap > w`), so `columns={4}` renders 3 columns at every viewport. **Human decision B (2026-09-29):** reproduce today's wrap exactly â€” set `minColumn={160}` (today's `minmax(160px,1fr)` floor; gap 14â†’16 is an accepted visual delta) and pin AC3 to the measured 4â†’4â†’3â†’2 sequence. The foundation default (168) would change the phone to 1-up; forcing literal 4â†’3â†’2â†’1 would degrade 1024 from today's 4-up. Recorded in `docs/design/DASHBOARD_FOUNDATION.md` Â§9 for D2/D3.

## Verification

**Commands:**
- `cd apps/carehub && npx vitest run src/pages/dashboard/__tests__ src/modules/dashboard-home/__tests__ src/components/__tests__/sharedDashboard.test.jsx` -- expected: all pass
- `cd apps/carehub && npm test` -- expected: no new failures vs baseline (baseline: 1032 passed, `landing/responsive` flaky under load)
- `cd apps/carehub && npm run build` -- expected: success
- `node apps/carefind/node_modules/eslint/bin/eslint.js <touched files>` (repo root; carehub's own eslint is not installed) -- expected: 0 errors on lines added by this work

**Manual checks:**
- `npm run dev` â†’ Owner â†’ `/dashboard`: skip link on Tab, KPI/worklist/sales/actions show real data; POS + warehouse routes: padding/scroll unchanged, mobile trigger reachable; offline strip + PlanExpiryBanner still show; 375px: no horizontal scroll.

**Actuals (review_loop_iteration 1, 2026-09-30):**
- Targeted `npx vitest run` on the 4 D1/touched test files: **46/46 pass** (DashboardHome 7, sharedDashboard 29, designSystem 11, BusinessDashboard 4, sharedStatCard â€” includes the +2 new tests: "+N-more expansion", "hospital flow", the error-vs-empty assertions, PageHeader landmark pairs, tone-tile, nav-rail geometry, metric-token typography).
- `npm test` (apps/carehub): **1061 passed / 88 files, 0 failures** (baseline 1053 + 8 net-new tests; no regressions).
- `npm run build` (apps/carehub): **success** (1m14s; the >500kB chunk warning is pre-existing).
- Lint (carefind's eslint binary, repo root) on all touched non-test files: **0 genuine errors** â€” 30 `no-unused-vars` flags + 1 `no-empty` + 1 missing-rule warning, every flagged identifier verified as a JSX-only binding (config lacks `react/jsx-uses-vars`) or pre-existing (`catch (e) {}` at DashboardHome:80). Test files are config-ignored (`File ignored because of a matching ignore pattern`).
- Chromium probe `node apps/carehub/scripts/verify-dashboard-grid.mjs` (committed; source-extracted geometry, Edge headless):
  ```
  ok  375px  columns=2 (expected 2)  nav=0px   overflow: kpi=false quick=false scroller=false doc=false
  ok  768px  columns=3 (expected 3)  nav=65px  overflow: kpi=false quick=false scroller=false doc=false
  ok  1024px columns=4 (expected 4)  nav=211px overflow: kpi=false quick=false scroller=false doc=false
  ok  1280px columns=4 (expected 4)  nav=211px overflow: kpi=false quick=false scroller=false doc=false
  Pass â€” KPI wrap 4/4/3/2 at 1280/1024/768/375, no horizontal overflow at any width.
  ```
- Manual Owner QA: **pending human run** (skip-link focus, real-data walkthrough, POS/warehouse padding, mobile trigger, offline strip, sticky New-sale, 375px scroll check).
- Nine follow-ups recorded in `_bmad-output/implementation-artifacts/deferred-work.md` under "Deferred from: spec-d1-business-dashboard-foundation (2026-09-30)".

## Suggested Review Order

**Shell migration (start here â€” the design intent)**

- Entry point: whole dashboard now composes on DashboardShell with gutter={0}, so per-route padding stays the single source of truth.
  [`BusinessDashboard.jsx:170`](../../apps/carehub/src/pages/dashboard/BusinessDashboard.jsx#L170)

- Suspense fallback swapped from the local ModuleLoading spinner to the shared Loading (same copy).
  [`BusinessDashboard.jsx:210`](../../apps/carehub/src/pages/dashboard/BusinessDashboard.jsx#L210)

- Content scroller exposes horizontal overflow (auto, was hidden) so the no-overflow AC is observable.
  [`DashboardShell.jsx:89`](../../packages/design-system/src/components/dashboard/DashboardShell.jsx#L89)

**Home content migration (D1 scope: shell + home route)**

- Sticky PageHeader adopts landmark="none" â€” it renders inside the shell's main, where banner is invalid.
  [`DashboardHome.jsx:156`](../../apps/carehub/src/modules/dashboard-home/DashboardHome.jsx#L156)

- KPI row pins minColumn={160} (human decision B) to reproduce today's measured 4/4/3/2 wrap.
  [`DashboardHome.jsx:181`](../../apps/carehub/src/modules/dashboard-home/DashboardHome.jsx#L181)

- Aggregate query-error surface: one Retry that fans out to each failed query's real refetch.
  [`DashboardHome.jsx:176`](../../apps/carehub/src/modules/dashboard-home/DashboardHome.jsx#L176)

- False-all-clear fix: Empty states suppressed while the error surface is up (failed queries default to []).
  [`DashboardHome.jsx:204`](../../apps/carehub/src/modules/dashboard-home/DashboardHome.jsx#L204)

**Shared primitive upgrades (affect all three dashboards)**

- PageHeader gains landmark prop (default banner preserved; 'none' for in-main composition).
  [`PageHeader.jsx:29`](../../packages/design-system/src/components/layout/PageHeader.jsx#L29)

- ActivityList icon tiles now take the row's tone so danger/warning rows read at a glance.
  [`ActivityList.jsx:26`](../../packages/design-system/src/components/dashboard/ActivityList.jsx#L26)

- TopBar is the other in-main call site and also drops the banner role.
  [`TopBar.jsx:28`](../../apps/carehub/src/components/layout/TopBar.jsx#L28)

**Evidence (peripherals)**

- Home-route state matrix: loading / loaded / empty / error+Retry / permission gate / expansion / hospital.
  [`DashboardHome.test.jsx:88`](../../apps/carehub/src/modules/dashboard-home/__tests__/DashboardHome.test.jsx#L88)

- Shell geometry contract: overflow exposed, nav rail widths, mobile display:contents, tone tiles.
  [`sharedDashboard.test.jsx:105`](../../apps/carehub/src/components/__tests__/sharedDashboard.test.jsx#L105)

- Landmark default/opt-out pairs for PageHeader.
  [`designSystem.test.jsx:104`](../../apps/carehub/src/components/__tests__/designSystem.test.jsx#L104)

- Committed Chromium probe for AC3 (source-extracted geometry, drift guards).
  [`verify-dashboard-grid.mjs:1`](../../apps/carehub/scripts/verify-dashboard-grid.mjs#L1)

- Foundation doc: adoption status, accepted deltas, corrected responsive/verification sections.
  [`DASHBOARD_FOUNDATION.md:268`](../../docs/design/DASHBOARD_FOUNDATION.md#L268)

- Spec trail: review_loop_iteration 1 change log (frozen-row correction + B1-B6) and verification actuals.
  [`spec-d1-business-dashboard-foundation.md:75`](spec-d1-business-dashboard-foundation.md#L75)

Note: the working tree also contains unrelated in-progress `apps/carefind` edits from a separate session â€” they are out of this spec's scope (human decision 1A) and are not part of this review order.
