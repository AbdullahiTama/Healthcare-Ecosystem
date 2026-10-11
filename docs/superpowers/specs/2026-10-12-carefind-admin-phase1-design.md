# CareFind Admin Redesign, Phase 1: Foundation and Overview

Date: 2026-10-12
Branch: `feat/carefind-admin-phase1` (cut from `main`)
Status: draft for owner review

## 1. Intent

Turn the CareFind admin (`apps/carefind/src/modules/admin/`) into a premium
operations console without changing authentication, authorization, backend
logic, or financial calculations.

This spec covers **Phase 1 only**: state extraction, the new shell and topbar,
shared UI components, and a real Overview with a "Needs Attention" queue.
Phases 2 to 5 get their own spec, plan and PR:

| Phase | Scope |
|---|---|
| 1 | Foundation: provider, shell/topbar, shared UI, Overview + Needs Attention |
| 2 | People and trust: Users, Businesses, Verification, Claims, Reports, Moderation |
| 3 | Finance: Revenue, Withdrawals, Orders, Money Checks |
| 4 | Content and Live: Posts, Stories, News, Promotions, Go Live |
| 5 | System: Teams, Audit, Errors, Searches, Drug Intel, Email Templates, Shop; delete the legacy adapter |

This is independent of the unmerged `feat/carefind-admin-console` branch (PR #3).
The owner chose a fresh redesign of `main`; if both land, one must be dropped.

### Success criteria

- Every current feature remains reachable (all 27 tabs).
- Overview shows only real values. A failed source shows an error state, never 0.
- Needs Attention is built from one tested function.
- No change to `adminApi.js`, `api/`, SQL, `callAdminAuth`, or any financial calculation.
- Works at 375, 390, 768, 1024, 1440, 1920. Keyboard operable. Reduced motion respected.
- Tests, lint and build pass.

## 2. Current state (findings from mapping `main`)

`AdminPanel.jsx` is 934 lines: about 120 `useState` hooks, every action
handler, session verification, four realtime channels, and a 27-way tab switch
passing 30+ props into some tabs. `Overview` renders three overlapping
components (`HealthPulse`, `DashboardTab`, `OverviewTab`).

### Findings, documented not fixed (out of scope: backend or financial)

1. **User count is always 0** in `useAdminData` (`getUsers({limit:1}).then(() => 0)`).
2. **Failures look like empty data.** Every fetch ends in `.catch(() => [])`.
3. **`dashboardRepository.getStats().revenue` sums `verifRes`**, not transactions; always 0. Financial calculation, reported only.
4. **Pending withdrawals defined two ways.** `useAdminData` counts `pending`; `getNotifications` and `WithdrawalsTab` use `reserved`/`processing`.
5. **Notification list built twice** (`hooks/queries.js` and `dashboardRepository.getNotifications`), already drifted.
6. **Lists are capped** (posts 50, users 100); `.length` is not a total.
7. **SECURITY: read and action handlers in `api/_handlers/admin-auth.js` only verify a valid token.** Only staff, team and role management check `super_admin`. Any admin role can call `list_withdrawal_requests`, `list_transactions`, etc. directly. The sidebar `permissions[key] !== false` filter is cosmetic. Needs a separate server-side per-action permission map.
8. `adminLoggingOut` guard is declared in the render body, so it resets each render (fixed in Phase 1, own commit).
9. `postLiveItem` reads `localStorage.admin_token`, which `callAdminAuth` strips; dead, harmless.
10. Browser uploads straight to storage buckets; `BusinessesTab` receives the raw `supabase` client (Phase 2/4).
11. `amount * 200` currency conversion is performed in notification display code (kept, flagged).

## 3. Architecture (approach A: provider + adapter)

```
modules/admin/
  AdminPanel.jsx          thin: <AdminProvider><AdminShell/></AdminProvider>
  provider/
    AdminProvider.jsx     session verify, permissions, toast, confirm, realtime, signOut
    useAdmin.js
  shell/
    AdminShell.jsx        sidebar + topbar + content + drawer host
    Topbar.jsx
    navigation.js         the nine groups, existing tabs only
  sections/
    OverviewSection.jsx
  lib/
    attention.js          single pure queue builder
  hooks/
    useOverviewData.js
  ui/                     MetricCard, StatusBadge, DataTable, Drawer, StateBlock
  legacy/
    LegacyTabHost.jsx     today's props for unmigrated tabs; shrinks per phase
```

Rules:
- `AdminProvider` calls `supabase.auth.getSession` and `callAdminAuth('verify')` exactly as `AdminPanel` does now; failure signs out, clears the cache and goes to `/login`.
- `useAdminData` and the repositories are untouched so unmigrated tabs behave identically.
- The legacy adapter keeps each tab's existing state and handlers until its phase migrates them.
- Tab state stays local React state; no routing change.

### Navigation (existing tabs only)

Overview (Dashboard, Alerts) / Platform (Users, Businesses) / Trust and Verification
(Verifications, Claims, Reports, Moderation Queue) / Marketplace (Shop, Orders) /
Content (Posts, Stories, News, Promotions, Go Live) / Finance (Revenue, Withdrawals,
Money Checks) / Operations (Tasks, Teams) / Analytics (Searches, Drug Intel) /
System (Audit Log, Errors, Email Templates). Permission filtering is retained.

## 4. Overview

### Data
`useOverviewData` fetches each source independently with `Promise.allSettled`;
each yields `{status: 'ok'|'error'|'forbidden', data}`. User and business totals use
head counts, not list length. Sources: verification requests, claims, reports,
transactions, withdrawals, task submissions, consultations, news.

### Needs Attention
`lib/attention.js` is the only queue builder. Withdrawals count when status is
`reserved` or `processing`. Each row: lucide icon, severity chip (urgent / warning /
info, quiet styling), title, supporting text, relative time, per-type count and a
"Review" action opening that section. Empty queue shows "All clear". The old copies
stay for now and are flagged for removal when the Alerts tab migrates.

### Metric grid
Users, businesses, pending verification, pending claims, open reports, transactions
(count), pending withdrawals, platform activity (posts in the last 24 hours, head count).
Finance cards hide on permission `false` or API 401/403 (courtesy only, see finding 7).
No invented values, no trend lines.

### Platform health
No historical series exist, so show current-state breakdowns (verification status
split, report status split) as small stacked bars with text labels.

## 5. Shell and UI

The owner approved a static mockup of the shell and Overview on 2026-10-12
(https://claude.ai/artifact/LeTEjJFNdYMQzw3myZZPZe, sample figures). It is the
visual reference for this phase; where this section and the mockup differ, the
mockup wins.

- Direction: a ledger. Mostly table and list, tabular numerals, almost no decoration.
- Sidebar: 232px on the canvas colour with a hairline right border. Group labels
  11px uppercase; items 32px tall, 13px label; active item has a 2px accent left bar
  and a panel-coloured fill. Pending counts are plain grey numerals, right-aligned.
  Collapsible to a 56px icon rail by the user; off-canvas under 900px, opened from a
  topbar menu button.
- Topbar: 52px, hairline bottom border. Breadcrumb left; a search field up to 360px
  that opens the existing `CommandPalette` (Ctrl/Cmd+K); then alerts with the existing
  `roleNotifCount`, AI Copilot (moved from the floating button), and the account menu
  with name, role and sign out.
- Content: fluid, 24px gutters (16px under 900px), max 1440px (replaces the 960px cap).
- Metric strip: one panel divided by hairlines into 4 x 2 cells (2 x 4 under 900px),
  not eight cards. Cell: 12px label, 26px semibold number, one context line. A failed
  source shows "Couldn't load" with a Retry action in the number's place.
- Lower row: Needs Attention takes two thirds, Current State one third; they stack
  under 1100px. Queue rows are 52px with icon, title, one context line, severity chip
  (dot plus word), relative time and a chevron; severity filter tabs with counts on top.
  Under 560px the chip and time wrap to a second line.
- Type scale: 11 / 12 / 13 / 15 / 20 / 26. `font-variant-numeric: tabular-nums`.
- Colour: canvas `--color-bg`, panels white (`--color-surface` in dark), 1px borders,
  10px radius, no shadows. Accent (`--color-primary`) only for the active nav item,
  primary buttons, links and focus rings. Urgent is amber-brown, not red; red is kept
  for destructive buttons. Use existing tokens from `tokens.css`; add admin-scoped
  tokens only where none exists (severity washes), defined for light and dark.
- Drawer: 480px from the right, header (title, status, close), scrolling body, sticky
  footer with the primary action on the right; page behind dimmed. Full screen on phones.
- Components: `MetricCard`, `StatusBadge` (single status-to-tone map), `DataTable`
  (compact, sortable only where the page holds full data, pagination, stacked rows
  under 768px), `Drawer` (right panel desktop, full-screen mobile, focus trap, Esc),
  `StateBlock` (loading / empty / error with retry). Reuse `ConfirmDialog`, `Toast`,
  `Loading`. Phase 1 uses `DataTable` and `Drawer` only in Needs Attention; Users and
  Businesses adopt them in Phase 2.
- Motion: drawer slides 16px with a fade over 180ms, menus fade over 120ms, nothing
  animates on load; all disabled under `prefers-reduced-motion`.
- Accessibility: one `h1` per section, `nav` landmark with `aria-current`, visible
  focus, labelled icon buttons, status never by colour alone, WCAG AA contrast.

## 6. Security

- No change to `adminApi.js`, `callAdminAuth`, `api/`, SQL, or the `verify` flow.
- Client permission checks stay cosmetic; the server remains the boundary
  (and has the gap in finding 7).
- Needs Attention and finance cards show only data the existing endpoints already
  return to the signed-in admin; Phase 1 adds no new endpoints or queries beyond
  head counts on tables the admin already reads.
- Sign-out calls the same server logout and clears the same cache keys.

## 7. Testing

- Unit: `attention.js` (shape, ordering, severity, withdrawal statuses),
  `StatusBadge` mapping, `DataTable` sort and paging.
- Component: `OverviewSection` loading, per-source error, forbidden, empty;
  shell nav filtering by permission; drawer focus trap; sign-out behaviour.
- Regression: `UsersTab.test`, `ReconciliationTab.test`, `CommandPalette.test`,
  `HealthPulse.test` (moved with the component) still pass.
- Gates: tests, lint, build. Responsive verified by measurement at 375, 390, 768,
  1024, 1440, 1920 (screenshots are unreliable in this repo's browser tooling).

## 8. Delivery

One PR from `feat/carefind-admin-phase1`, commits per unit: provider extraction,
`adminLoggingOut` fix (separate behaviour commit), shared UI, shell, Overview.
Remove `HealthPulse`, `DashboardTab`, `OverviewTab` only after `OverviewSection`
is verified. Add `docs/ADMIN_REDESIGN.md` with the phase plan and findings above.
Nothing is pushed to `main`.

## 9. Out of scope

Backend, SQL, financial calculations, routing changes, historical analytics,
Phases 2 to 5, resolving the PR #3 overlap.
