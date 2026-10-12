# CareFind admin redesign

Design: `docs/superpowers/specs/2026-10-12-carefind-admin-phase1-design.md`.
Code: `apps/carefind/src/modules/admin/`.

## Phases

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: `AdminProvider`, shell and topbar, Overview with Needs attention | built on `feat/carefind-admin-phase1` |
| 2 | People and trust: Users, Businesses, Verification, Claims, Reports, Moderation | not started |
| 3 | Finance: Revenue, Withdrawals, Orders, Money checks | not started |
| 4 | Content and Live: Posts, Stories, News, Promotions, Go live | not started |
| 5 | System: Teams, Audit, Errors, Searches, Drug intel, Email templates, Shop; delete `legacy/` | not started |

## How the code is organised

```
AdminPanel.jsx             AdminProvider > AdminShell > active section
provider/AdminProvider.jsx session verify, permissions, toast, confirm, realtime, sign-out
shell/                     AdminNav, Topbar, AdminShell (uses the design-system DashboardShell)
navigation.js              the nine groups; every tab key lives here once
sections/                  redesigned screens (OverviewSection, FeedRankingSection)
legacy/LegacyTabHost.jsx   screens not yet redesigned, with the props they always had
lib/attention.js           the one builder for the Needs attention queue
hooks/useOverviewData.js   Overview data, one settled result per source
ui/                        MetricStrip, SplitBar, admin.css (admin-scoped tokens)
```

Session checks are unchanged: `AdminProvider` calls `getSession` and the server's
`verify` action, and renders nothing without a verified admin. `permissions` only
hides navigation; the server decides what any request may do (see finding 7).

## Migrating a tab out of `legacy/` (one phase's job)

1. Create `sections/<Name>Section.jsx`. Read shared things with `useAdmin()`
   (`showToast`, `askConfirm`, `invalidateAdmin`, `recordAction`, `adminUser`).
2. Move that tab's `useState` hooks and handlers from `LegacyTabHost.jsx` into the
   section. Delete them from the host, along with the tab's line in its render list.
3. Render the section from `ActiveSection` in `AdminPanel.jsx`.
4. Test loading, error, empty and permission-hidden states.

A source that fails to load must show as failed, never as an empty list or zero.

## Findings (documented, not fixed in Phase 1)

Backend, SQL and financial calculations are out of scope for this work.

1. **Security.** Most read and action handlers in `api/_handlers/admin-auth.js` only verify
   a valid token. Only staff, team and role management check `super_admin`. Any admin
   role can call `list_withdrawal_requests`, `list_transactions` and the rest directly.
   Needs a server-side per-action permission map.
2. `useAdminData` always reports 0 users (`getUsers({limit:1}).then(() => 0)`).
3. `useAdminData` turns every failed fetch into an empty list.
4. `dashboardRepository.getStats().revenue` sums verification requests, not transactions
   (always 0). Financial calculation, reported only.
5. Pending withdrawals are defined two ways: `pending` in `useAdminData`, `reserved` or
   `processing` in `getNotifications` and `WithdrawalsTab`. The new Overview uses the latter.
6. The notification list is built twice (`hooks/queries.js` and
   `dashboardRepository.getNotifications`) and has drifted. `lib/attention.js` is the
   third builder until the Alerts tab migrates, then the other two go.
7. Server list caps: reports 30, transactions 50, news 60, task submissions 20. The
   Overview shows `N+` when a list reaches its cap; a count from a capped list can undercount.
8. The sign-out double-click guard was declared in the render body and reset every
   render. Fixed in `AdminProvider` (a ref).
9. After a failed `verify`, the old panel rendered its content with no admin for an
   instant before redirecting. `AdminProvider` now renders nothing without a verified admin.
10. `postLiveItem` reads `localStorage.admin_token`, which `callAdminAuth` strips. Dead, harmless.
11. Browser uploads go straight to storage buckets, and `BusinessesTab` receives the raw
    `supabase` client (Phase 2 and 4).
12. The notification text converts withdrawal amounts with `amount * 200`. The new queue
    shows no currency amounts.
13. The old Overview showed revenue twice with different maths. The new one shows the
    transaction count only; revenue stays in Finance.
14. `dashboardRepository.getHealthPulse` has no caller now that `HealthPulse` is gone.
    Kept with its tests; remove in Phase 3.
15. Consultation bookings appear in the queue with no action, because no screen lists them.

## Verification state

Unit and component tests cover the queue builder, navigation, Overview data, the
metric strip, `OverviewSection` (loading, per-source error, capped, permission-hidden,
empty) and `AdminProvider` (verify, fail-closed, sign-out). The pre-existing panel
test passes against the new shell. Responsive behaviour at 375, 390, 768, 1024, 1440
and 1920 has not been measured in a browser yet; see the PR description.
