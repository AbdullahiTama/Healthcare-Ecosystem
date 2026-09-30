# Dashboard Foundation

The shared visual language for the three dashboards being redesigned:

1. **CareHub Business Dashboard** — healthcare business operating system
2. **CareHub Admin Dashboard** — platform operations for CareHub
3. **CareFind Admin Dashboard** — discovery/content/platform operations control center

Two products, one foundation. The goal is that a person who uses CareHub and
then opens CareFind Admin recognises the same grammar — canvas, surfaces, type
rhythm, spacing, table density, state treatment — without the two products
becoming the same product.

**This is the foundation only.** It adds tokens and primitives; it does not
rewrite any existing screen. Adoption happens dashboard by dashboard (D1 → D2 →
D3).

Read with: `DESIGN_PRINCIPLES.md`, `SPACING.md`, `TYPOGRAPHY.md`,
`COLORS.md`, `GRID_SYSTEM.md`, `ACCESSIBILITY.md`, `MOTION.md`.

---

## 1. What already existed (and is reused, not rebuilt)

The repo already has a shared package both apps alias to —
`packages/design-system`. Nothing new was added to `package.json` in either app.

| Need | Existing primitive | Status |
|---|---|---|
| Page / top-bar header | `PageHeader` (`compact` = top utility bar) | reused as the dashboard header |
| Metric tile | `StatCard` | reused; now reads `type.metric` / `type.metricLabel` |
| Data table | `DataTable` (aria-sort, mobile → cards) | reused |
| Status label | `StatusBadge`, `Pill` | reused |
| Empty / loading / error | `Empty`, `Skeleton`, `CardSkeleton`, `ErrorState` | reused |
| Base surface, buttons, forms, modal, toast | `Card`, `Button`, `Form`, `Modal`, `Toast` | reused |
| Breakpoints | `useBreakpoint` (320/768/1024/1440/1920) | reused |

`DashboardHeader` from the component wish-list is deliberately **not** built:
`PageHeader` already covers both shapes (compact utility bar, full page header).
Two headers would be the exact duplication this foundation exists to remove.

`MetricCard` is `StatCard`. `DataTable`, `StatusBadge`, `EmptyState`,
`Skeleton`, `ErrorState` already exist. Building a second one is not
foundational work, it is debt.

---

## 2. Tokens added

All additive — no existing value changed, so no screen outside the dashboards
moves.

### Typography (`theme.type`)

| Role | Token | Value |
|---|---|---|
| Page title | `type.h1` | 21 / 900 / -0.02em |
| Page subtitle | `type.body` | 13 / 500 |
| Section title | `type.h2` | 18 / 800 / -0.015em |
| Card title | `type.h3` | 15 / 800 |
| Metric label | `type.metricLabel` | **12 / 600 / 0.01em** (new) |
| Metric value | `type.metric` | **28 / 800 / -0.02em** (new) |
| Supporting text | `type.bodySm` | 12 / 600 |
| Micro metadata | `type.micro` | 10.5 / 700 / 0.04em |

The metric value sits between `h2` and `display`: a row of four KPIs reads as
data, not as four competing headlines. That is the "dominant without oversized"
rule made concrete.

### Spacing (`theme.space`)

The dashboard set is **8 · 12 · 16 · 20 · 24 · 32 · 40 · 48** →
`space[4] [6] [8] [10] [11] [12] [13] [14]`. `space[13]` (40) and `space[14]`
(48) are new; everything else already existed. Use this set. Anything else
needs a reason written down.

### Surfaces

- Canvas: `theme.bg` (very light neutral). Not a gradient, not white.
- Card: `theme.cardBg` + `1px solid theme.border` + `theme.elevation[1]`.
- Radius: `theme.radius.lg` (14) — inside the 12–18 band for dashboard
  surfaces. No new radius token was created for this.
- Elevation: `elevation[1]` at rest, `[2]` on hover, `[3]` for menus/popovers.

### Dashboard geometry (`theme.dashboard`) — new

```js
dashboard: {
  navWidth: 232,           // expanded left rail
  navCollapsedWidth: 72,   // icon-only rail
  topbarHeight: 56,        // utility bar
  contentMaxWidth: 1240,   // content stops growing here
  asideWidth: 300,         // right context panel (>=1024px only)
  metricMin: 168,          // MetricGrid tile floor
  chartMinHeight: 180,     // plot area floor
}
```

Lengths only. Color, spacing, radius, type and elevation stay in their own
scales so a dashboard can never drift from the rest of the system. Products
override per instance (a rail can be wider) instead of forking the tokens.

### Color

Existing semantic tokens only: `success`, `warning`, `danger`, `info` for
state; `tealDeep` for CareHub's primary actions; `tealBright` available for
CareFind's consumer surfaces; `navy` for headings. No card gets a color for
decorative reasons — accent color means *state*.

---

## 3. Primitives

New directory: `packages/design-system/src/components/dashboard/`, re-exported
from `components/ui`, so both apps' existing barrels pick them up with no
import-path change.

| Primitive | Replaces | Notes |
|---|---|---|
| `DashboardShell` | CareHub `BusinessDashboard` shell + CareFind `AdminLayout` | nav / topbar / main / aside slots; owns geometry, max-width, gutters, skip link, `<main>` landmark |
| `MetricGrid` | ad-hoc `repeat(auto-fit,minmax(...))` grids | `columns` → percentage floor; `minColumn` → px floor; wraps, never overflows |
| `SectionCard` | ~34 card wrappers + ~9 header rows | real `<h2>/<h3>` (via `headingLevel`), `title` / `sub` / `actions` |
| `ChartCard` | — | `SectionCard` + mandatory `loading` / `error` / `empty` states, plot floor height, `legend` slot |
| `Sparkline` | 3 duplicated SVG sparklines | `role="img"` + generated summary ("12 points, 1.2m → 1.9m, up") |
| `BarList` | % div-bars in Reports ×3, AdminDashboard trend, ranked lists | semantic `<ul>`; bars `aria-hidden`, values carried by text |
| `ActivityList` | worklist / recent sales / audit log / queue rows | interactive rows are real `<button>`s; default or custom empty state |
| `SearchBar` | ≥11 hand-rolled search inputs | visible or sr-only `<label>`, clear button, `role="search"` |
| `FilterBar` | per-screen filter rows | a `role="group"` row; owns no controls, hosts yours |
| `QuickAction` | dashboard quick-action tiles | real `<button>`, `disabled` state |
| `UserMenu` | 3 hand-rolled identity chips | `aria-haspopup="menu"`, focus in/out, Escape, arrows, outside click; degrades to a chip with no items |

Import from either app barrel:

```jsx
import { DashboardShell, PageHeader, MetricGrid, SectionCard, ChartCard,
         Sparkline, BarList, ActivityList, SearchBar, FilterBar,
         QuickAction, UserMenu, StatCard, DataTable, StatusBadge,
         Empty, Skeleton, ErrorState } from '../../components/ui'
```

### Canonical composition

```jsx
<DashboardShell nav={<Sidebar />} topbar={<PageHeader compact title="Dashboard" rightSlot={…} />}>
  <PageHeader title="Today" description="…" primaryAction={…} />
  <MetricGrid minColumn={160} label="Key metrics">
    <StatCard … /> <StatCard … /> <StatCard … /> <StatCard … />
  </MetricGrid>
  <SectionCard title="Needs your attention">
    <ActivityList … />
  </SectionCard>
  <ChartCard title="Revenue" legend={…} loading={q.isLoading} error={q.isError} onRetry={q.refetch}>
    <Sparkline data={revenueTrend} />
  </ChartCard>
</DashboardShell>
```

`minColumn`, not `columns` — see §4 and the §9 gotchas: for a 4-tile KPI row the
percentage floor `columns` derives can never fit 4 tracks alongside the gap, so
pin the pixel floor you actually measured.

---

## 4. Responsive

Designed layouts at 375 · 390 · 768 · 1024 · 1280 · 1440 · 1920, driven by CSS
where possible (grids wrap themselves) and `useBreakpoint` only where JS is
genuinely required (shell geometry).

| Width | Shell |
|---|---|
| < 768 | no rail in flow (`display: contents` — the app's drawer owns it), 16px gutters, no aside |
| 768–1023 | collapsed 72px rail, no aside |
| 1024–1439 | 232px rail, aside shown, 24px gutters |
| ≥ 1440 | content capped at 1240px and centred — it stops stretching |

`MetricGrid` wraps down the row (D1's KPI row measures **4 / 4 / 3 / 2 columns
at 1280 / 1024 / 768 / 375** with `minColumn={160}` — see §9; the floor you pin
determines the sequence). `FilterBar` wraps and pushes its right slot to its own
line. No horizontal overflow at any of the seven widths — the shell's content
scroller uses `overflowX: 'auto'` so overflow stays visible instead of being
clamped.

---

## 5. Accessibility

Non-negotiables carried into every primitive:

- **Landmarks**: `<main id="ds-main-content">` + "Skip to main content" link in
  `DashboardShell`; `role="search"` on `SearchBar`; `role="group"` with a name
  on `MetricGrid` / `FilterBar`; `<aside aria-label>` for the context panel.
  `PageHeader` claims `role="banner"` by default — pass `landmark="none"` when
  it is composed **inside** `<main>` (banner is not a valid descendant of main).
- **Headings**: `SectionCard` renders a real `<h2>`/`<h3>`, so heading shortcuts
  navigate the dashboard.
- **Never color alone**: state is text + color (`StatusBadge`, `BarList` values,
  `ActivityList` badges).
- **Names**: every icon-only control has an `aria-label` (clear button, account
  trigger).
- **Menus**: `aria-haspopup`/`aria-expanded`, focus moves in on open, Arrow
  keys cycle, Escape closes and restores focus, outside click closes.
- **Charts**: `Sparkline` is `role="img"` with a written summary; `BarList`
  exposes values as text and hides the bar; `ChartCard` announces loading via
  `role="status" aria-live="polite"` and errors via `role="alert"`.
- **Focus**: global `:focus-visible` outline (both apps) — primitives use
  borders/`tealMist` rings on inputs, consistent with `PageHeader`.
- **Motion**: nothing in this layer animates on load or scroll, so
  `prefers-reduced-motion` is satisfied by default. Transitions are hover/focus
  feedback only (`theme.motion.fast`).

---

## 6. Charts: no library

Neither app has a chart dependency, and one was not added.

- A trend line and ranked bars are the only chart shapes the dashboards
  currently need; both are small, deterministic SVG/CSS that read from real
  application data.
- Adding a charting library would be a bundle-size and API-surface cost across
  two apps to serve two shapes.
- If a future dashboard needs axes, tooltips across series, or time-series
  zoom, revisit this decision explicitly — with a measured bundle delta — in
  `docs/design/COMPONENT_LIBRARY.md`.

Charts must never be fed fabricated metrics: data comes from the page's own
queries; an empty series renders `ChartCard`'s empty state, not a made-up line.

---

## 7. Rules for D1–D3

1. Canvas stays `theme.bg`; surfaces are `cardBg` + 1px border. No screen-wide
   gradients, no card-per-row, no shadow stacking.
2. Compose from `DashboardShell` + the primitives above before writing new
   inline layout.
3. Every data surface ships **loading / error / empty** — `ChartCard` and
   `ActivityList` enforce it; `DataTable` consumers must too.
4. Spacing from the 8/12/16/20/24/32/40/48 set only.
5. Accent color = semantic state. CareHub keeps teal/deep-teal; CareFind keeps
   its identity through content and density, not through a second palette.
6. No new dependency without a written justification and a measured cost.
7. Existing working components are upgraded in place, not replaced alongside.

---

## 8. Verification

- `apps/carehub` `npm test` — includes
  `src/components/__tests__/sharedDashboard.test.jsx` (29 tests: landmarks,
  nav-rail geometry, scroll containment, grid math, chart states, sparkline
  summary, list semantics + tone tiles, search labelling, menu keyboard
  behaviour, tokens), `designSystem.test.jsx` (PageHeader landmark behaviour),
  `sharedStatCard.test.jsx` (metric token typography), plus the D1 adoption
  tests `src/pages/dashboard/__tests__/BusinessDashboard.test.jsx` and
  `src/modules/dashboard-home/__tests__/DashboardHome.test.jsx`.
- `apps/carefind` `npm run lint` (its own eslint is installed), `npm run build`.
  carehub's `npm run lint` cannot run — carehub has no installed eslint; lint
  carehub files with the carefind binary from the repo root:
  `node apps/carefind/node_modules/eslint/bin/eslint.js <files>`.
- D1's KPI wrap sequence (AC3) is checked by the committed Chromium probe:
  `node apps/carehub/scripts/verify-dashboard-grid.mjs` (needs playwright-core;
  results recorded in the D1 spec's Verification section).

---

## 9. Adoption status

| Dashboard | Status | Notes |
|---|---|---|
| **D1 — CareHub Business Dashboard** | **implemented, in review (2026-09-30)** | `BusinessDashboard` renders through `DashboardShell` (skip link, `main#ds-main-content`, nav/topbar slots, `gutter={0}` so each route keeps its own padding); `DashboardHome` composes `PageHeader` (sticky wrapper, `landmark="none"` since it sits inside `<main>`), `MetricGrid` (KPI row pinned `minColumn={160}` — decision B, see below), `SectionCard`, `ActivityList`, `QuickAction` + shared `Loading`/`Empty`/`ErrorState`, including the aggregate query-error surface whose Retry calls the real `refetch`. Covering tests: `src/pages/dashboard/__tests__/BusinessDashboard.test.jsx`, `src/modules/dashboard-home/__tests__/DashboardHome.test.jsx`. |
| D2 — CareHub Admin Dashboard | not started | |
| D3 — CareFind Admin Dashboard | not started | |

**Accepted deltas from D1 (known, deliberate — do not re-litigate in D2/D3):**

- `ModuleLoading` (local spinner, "Loading module...") → shared `Loading` with
  the same text.
- `StatCard` now reads `type.metric` / `type.metricLabel` — this is
  package-wide: every `StatCard` screen in both apps (admin, hospital, POS
  modules) picks up the 28/800 and 12/600 typography, not just dashboards.
- Nav rail geometry: D1 passes `navWidth={210}` (today's rail) and the Sidebar
  collapses to its own 64px — deliberately **not** the theme defaults
  (232/72), which stay for D2/D3 to adopt or override per product.
- Shell content scroller is `overflowX: 'auto'` (exposes overflow) —
  behavior-preserving with the pre-foundation column, and required for the
  "no horizontal overflow" AC to be observable.
- The barrel re-exports **12** names (11 primitives in `dashboard/` + `PageHeader`
  from `layout/`); "11 primitives" throughout this doc counts the `dashboard/`
  directory only.

**KPI grid gotchas for D2/D3 (measured in real Chromium, 2026-09-29):**

- **`columns={n}` is unusable for n-track grids.** `MetricGrid` derives the
  floor as `100/n%`, and with the default `theme.space[8]` gap the auto-fit
  count never reaches `n` (a percentage minimum plus gaps can never fit `n`
  tracks: `n·(w/n) + (n−1)·gap > w`). Measured: `columns={4}` renders **3
  columns at 375/768/1024/1280** — 4 KPI tiles as 3+1 at every width.
- **The package default floor (168px) is not automatically your sequence
  either.** It wraps 1/3/4/4 at 375/768/1024/1280 (1-up on a phone).
- **Human decision B — D1 pins `minColumn={160}`** (today's pre-foundation
  `minmax(160px,1fr)` floor; gap 14→16 is an accepted visual delta) so the KPI
  row reproduces today's measured wrap exactly: **4/4/3/2 columns at
  1280/1024/768/375**, no horizontal overflow at any of the four widths
  (`DashboardHome.jsx`, covered by `DashboardHome.test.jsx`). The foundation
  default (`theme.dashboard.metricMin` = 168) stays the package default — D1's
  pin is a per-instance override, which is how `minColumn` is meant to be used.
