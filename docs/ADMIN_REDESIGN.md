# CareFind admin redesign

Design: `docs/superpowers/specs/2026-10-12-carefind-admin-phase1-design.md`.
Code: `apps/carefind/src/modules/admin/`.

## Phases

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: `AdminProvider`, shell and topbar, Overview with Needs attention | built (PR #22) |
| 2a | Trust queues: Verification, Claims, Reports, Moderation | built on `feat/carefind-admin-phase2a` (Verification, Claims, Reports, Moderation) |
| 2b | People: Users, Businesses | not started (Users, Businesses) |
| 3 | Finance: Revenue, Withdrawals, Orders, Money checks | not started |
| 4 | Content and Live: Posts, Stories, News, Promotions, Go live | not started |
| 5 | System: Teams, Audit, Errors, Searches, Drug intel, Email templates, Shop; delete `legacy/` | not started |

## How the code is organised

```
AdminPanel.jsx             AdminProvider > AdminShell > active section
provider/AdminProvider.jsx session verify, permissions, toast, confirm, realtime, sign-out
shell/                     AdminNav, Topbar, AdminShell (uses the design-system DashboardShell)
navigation.js              the nine groups; every tab key lives here once
sections/                  redesigned screens (OverviewSection, FeedRankingSection,
                           VerificationsSection, ClaimsSection, ReportsSection, ModerationSection)
legacy/LegacyTabHost.jsx   screens not yet redesigned, with the props they always had
lib/attention.js           the one builder for the Needs attention queue
hooks/useOverviewData.js   Overview data, one settled result per source
hooks/useTrustQueues.js    verification, claim and report lists, one settled result per source
hooks/useReviewActions.js  approve/reject/resolve actions and the credential viewer
lib/bulkModeration.js      runBulk: bulk actions act only on the types their labels name
ui/                        MetricStrip, SplitBar, ReviewQueue, ReviewDrawer,
                           admin.css (admin-scoped tokens)
```

The section list in the legacy host no longer includes the four trust tabs
(Verification, Claims, Reports, Moderation). `PostsTab` still uses the moderation
store, so `LegacyTabHost` keeps its own `ModerationProvider`.

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

## Findings (documented unless marked fixed)

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
16. Moderation report items are keyed by post id and bulk actions sent that id to
    `resolve_report`, which expects a report id. **Fixed** (commit 7dd455e): every pending
    report on the post is now resolved by its own id.
17. Moderation "Reject" on a report called `resolve_report`, identical to Approve.
    **Fixed** (commit 0ee9249): bulk actions act only on the types their labels name.
18. Moderation's flagged-post source comes from `useAdminData`, which turns a failed fetch
    into an empty list (finding 3), so the flagged-post part of the queue cannot show a
    load failure. Documented.
19. The shared `Modal` drawer is at most 500px wide: it fills the screen at 500px and
    below, but is not full-screen between 500 and 768px as the Phase 2a spec intended.
    Needs a width option in the shared `Modal` (not changed). Documented.
20. The legacy credential viewer called `window.open('', '_blank', 'noopener,noreferrer')`,
    which returns null per the HTML spec, so "View credential" almost certainly always
    showed the "browser blocked" message and never opened the document (not verified in a
    browser). **Fixed** in `useReviewActions` (commit 6530c54): open without a feature
    string and set `tab.opener = null` before navigating.
21. The shared `Modal` gives its card `onClick` (to stop backdrop clicks), and the shared
    `Card` turns any `onClick` into `role="button" tabindex="0"`, so every dialog and
    drawer container is announced as a button and is a tab stop. Accessibility defect in
    `packages/design-system`; not changed here. Documented.
22. The legacy `ModerationQueue` never passed `selectedCount` to `BulkActionBar`, so its
    bulk bar never rendered and the bulk actions were unreachable; findings 16, 17 and 23
    were latent. The new section renders the bar.
23. Legacy bulk delete could send `delete_post { id: null }` for a report whose post was
    already deleted. **Fixed**: the new `runBulk` skips and names such items (commit 67bb19a).
24. `commandRegistry.js` registers palette actions `approveAllVerifications` and
    `resolveAllReports` that nothing handles (pre-existing dead entries). Documented; not
    wired, because an unconfirmed "approve all" action would be unsafe.
25. Reject-verification and reject-claim only set the request status to rejected (no
    notification, no profile or business change); approve_claim sets the claim approved
    and `businesses.visible_on_carefind = true`. The drawer confirmation text states only
    this. Informational.

## Verification state

Phase 1: unit and component tests cover the queue builder, navigation, Overview data,
the metric strip, `OverviewSection` and `AdminProvider`. The pre-existing panel test
passes against the new shell.

Phase 2a: unit and component tests cover `useTrustQueues`, `useReviewActions`,
`ReviewDrawer`, `ReviewQueue`, the four sections, `bulkModeration` and `BulkActionBar`.
Responsive behaviour at 375, 390, 768, 1024, 1440 and 1920 has NOT been measured in a
browser, and no admin session was available, so none of this has been exercised against
the live backend.
