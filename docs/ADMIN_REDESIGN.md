# CareFind admin redesign

Design: `docs/superpowers/specs/2026-10-12-carefind-admin-phase1-design.md`.
Code: `apps/carefind/src/modules/admin/`.

## Phases

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: `AdminProvider`, shell and topbar, Overview with Needs attention | built (PR #22) |
| 2a | Trust queues: Verification, Claims, Reports, Moderation | built (PR #23) (Verification, Claims, Reports, Moderation) |
| 2b | People: Users, Businesses | built on `feat/carefind-admin-phase2b` (Users, Businesses) |
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
                           VerificationsSection, ClaimsSection, ReportsSection, ModerationSection,
                           UsersSection, BusinessesSection)
legacy/LegacyTabHost.jsx   screens not yet redesigned, with the props they always had
lib/attention.js           the one builder for the Needs attention queue
hooks/useOverviewData.js   Overview data, one settled result per source
hooks/useTrustQueues.js    verification, claim and report lists, one settled result per source
hooks/useReviewActions.js  approve/reject/resolve actions and the credential viewer
hooks/useUsersDirectory.js      Users page: server-side search and paging, exact total
hooks/useBusinessesDirectory.js Businesses page: same, via the transport
hooks/useUserActions.js         verify, suspend and delete a user
lib/bulkModeration.js      runBulk: bulk actions act only on the types their labels name
repositories/transport.js  `or` filter op (every term quoted and escaped) and `likeContains`
ui/                        MetricStrip, SplitBar, ReviewQueue, ReviewDrawer, DirectoryTable,
                           useDebounced, admin.css (admin-scoped tokens)
```

The section list in the legacy host no longer includes the four trust tabs
(Verification, Claims, Reports, Moderation) or Users and Businesses, and the host no
longer holds Users or Businesses state. `users` stays in `useAdminData` for Go Live (guest
picker); no screen reads the businesses or phone data from it any more. `PostsTab` still uses the moderation
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
26. Moderation lists every source as legacy did but now shows an item's actions only when
    its tab is permitted (`verifications`, `reports`, `posts`), in the drawer and the bulk
    bar. Legacy's Moderation had no reachable actions (finding 22). UI courtesy only; the
    server decides.
27. `list_reports` and `list_business_claims` in `api/_handlers/admin-auth.js` (~lines 661
    and 693) ignore the query error and return `[]`, so a failed query reaches Reports,
    Claims and Moderation as "Nothing waiting" despite the client settling each source;
    `list_reports` also caps at 30 rows across ALL statuses, so resolved rows use up the
    pending window. Documented (backend out of scope).
28. The shared `Modal` registers an Escape listener per open modal, so stacked modals all
    close; the drawer works around it with `preventClose` while a confirmation is open
    (`AdminProvider` exposes `confirming`). A "topmost modal only" rule belongs in the
    shared package (next to finding 21), as does a fix for rows rendering as nested
    interactive controls on phones (DataTable `onRowClick` makes each mobile card
    `role="button"` with the Review button inside). Documented.

29. Users and Businesses loaded the newest 100 rows (`useAdminData`: `getUsers({limit:100})`,
    `commerceRepository.getBusinesses`) and filtered in the browser, so search could not find
    older rows and the header "N total users" showed the loaded count. **Fixed** (commits
    dba466b, e2034d6, ca00dbd, 7ccc7b2): server-side search and paging (`list_user_profiles`
    params; `adminTransport.query` with exact counts).
30. `list_user_profiles` (`apps/carefind/api/_handlers/admin-auth.js`, ~line 606) interpolates
    the search term into `.or(...)`, so a comma or parenthesis in the term can change the
    filter. Backend; documented, not changed on the server. The Users search now replaces
    `, ( ) " \` with spaces (and collapses whitespace) in `search` and `specialty` before
    calling `list_user_profiles` (7bd2856), which avoids the server error for terms like
    "Obi, Ada" and stops a term adding a clause, but it is a client guard, not a backend fix:
    any other caller of the action is still exposed. The new Businesses filter cannot be injected
    (commit 1d13813: the `or` op quotes and escapes every term, with tests). Also, `*` in a
    search term acts as an ilike wildcard (PostgREST rewrites `*` to `%`), which can widen a
    match within the same column but never add a clause.
31. `phoneMap` is built only from verification requests, so most users have no Call button in
    the new drawer. Documented.
32. The Users "title" filter filtered `verification_label` in the browser while the server
    filters `specialty`; they never matched. **Fixed** (ca00dbd): the filter is now "Specialty".
33. `BusinessesTab` received an unused raw `supabase` client prop. Removed with the tab (7ccc7b2, 303925f).
34. Suspend fired with no confirmation. **Fixed**: it confirms (ca00dbd).
35. `manual_verify` writes no audit row and no action history, unlike suspend and delete.
    Kept as legacy parity; owner decision.
36. The legacy delete closed the user panel even when the delete failed, and refreshed anyway.
    **Fixed**: the drawer stays open with the error.
37. `suspend_user` sets `profiles.suspended_until` AND `is_verified = false`: suspending a user
    silently removes their verified status, and the legacy UI never said so. The new
    confirmation says so.
38. Suspension appears not to be enforced: nothing in the app, API or SQL in this repo reads
    `suspended_until` (only `suspend_user` writes it; an RLS SQL comment mentions it). It may be
    enforced in the live database or an auth hook, which this repo does not show. Needs a
    backend/product decision. The confirmation says "marked as suspended" and does not claim
    the user is blocked.
39. `delete_user` (`admin-auth.js` ~258-273) deletes reactions, comments, saved posts, follows
    (both directions), posts and the profile, but NOT the auth (sign-in) account, and ignores
    errors from the preliminary deletes, so a failed final delete can leave the content gone
    and the profile in place. The legacy wording "permanently deletes the account and all their
    posts" was not fully true; the new text says what the handler does.
40. The server does not stop an admin suspending or deleting their own account. The Users
    drawer hides both on the signed-in admin's own profile; that is UI only. **Corrected**
    (e8574f2): the check first shipped compared `profiles.id` with `adminUser.id`, which is the
    `admin_users` row id from `verify`, a different key from the sign-in id for real staff (see
    41), so it only worked where the two coincide (the QA seed). It now compares the profile id
    with the sign-in user id from the Supabase session (`authUserId` on the admin context) and
    also with `adminUser.id`, and fails closed (both hidden) while the sign-in id is unknown.
    The legacy `UsersTab` Delete (`selectedUser.id !== adminUser?.id`) had the same defect, and
    failed open. Also minor, now **fixed**: the `DirectoryTable` search box dropped a search
    retyped within 300 ms of "Clear filters" (76280d3); `FilterPills` had no `aria-pressed` or
    group label (bdebc34); the Businesses average counted a null or non-numeric rating as 0
    (2a17df3). Still open: `useTrustQueues` is loaded on the Users tab only to build phone links.
41. `admin_users.id` is not the sign-in id for staff created via `create_staff`
    (`admin-auth.js` ~113-122 inserts `auth_user_id` and never sets `id`); `auth_user_id` is the
    link (`api/_lib/requireAdmin.js` ~21, migration `carefind_20260926_admin_users_auth_only.sql`).
    Only the QA seed inserts `id = auth_user_id`. Anything that assumes
    `adminUser.id === auth user id` (or `=== profiles.id`) is wrong outside the QA seed. To size
    it in production: `select count(*) from admin_users where id <> auth_user_id`. Documented.
42. The Users total (a head count through the browser Supabase client, so RLS applies) and the
    Businesses list and count also go through the browser client, while the Users LIST comes
    from the service-role server (`list_user_profiles`). If RLS hides profiles, or unclaimed
    businesses, from the admin's browser session, the Users total reads low and an "Unclaimed"
    filter reads as "No businesses match". The Businesses path is the same as legacy.
    Unverified against the live database. Documented.
43. The server's "Unverified" filter is `neq('is_verified', true)`, which in SQL excludes rows
    where `is_verified` IS NULL; the legacy browser filter (`!u.is_verified`) kept them. No
    definition of `profiles.is_verified` (type, default, NOT NULL) exists in `apps/carefind/sql`
    or `supabase/migrations` (it is only read or set there), so whether the column can be NULL
    cannot be determined from this repo. If it can, unverified users with NULL are missing from
    the "Unverified" filter. Check the live column; documented, not changed.
44. The "Joined" (Users) and "Added" (Businesses) columns are not sortable (2a17df3): the shared
    `DataTable` sorts only the rows it is given (the 25 on screen), and the sort survived paging,
    which read as a global sort. A real sort needs an `order` parameter on the server queries.
    The directory pager now also says "Page N" in a polite live region, and an open drawer
    survives list refreshes that move its row off the page (9397528).

## Verification state

Phase 1: unit and component tests cover the queue builder, navigation, Overview data,
the metric strip, `OverviewSection` and `AdminProvider`. The pre-existing panel test
passes against the new shell.

Phase 2a: unit and component tests cover `useTrustQueues`, `useReviewActions`,
`ReviewDrawer`, `ReviewQueue`, the four sections, `bulkModeration` and `BulkActionBar`,
and the panel's routing and permission fallback for the four tabs.
Responsive behaviour at 375, 390, 768, 1024, 1440 and 1920 has NOT been measured in a
browser, and no admin session was available, so none of this has been exercised against
the live backend. Bulk approval of verifications has no confirmation step (this matches
the spec; consider adding one). Responsive widths, the credential popup across browsers,
and where focus lands after an action removes a row all remain unverified without a
browser and an admin session.

Phase 2b: unit and component tests cover the transport `or` op, `useUsersDirectory`,
`useBusinessesDirectory`, `useUserActions`, `useDebounced`, `DirectoryTable`, `UsersSection`,
`BusinessesSection` and the panel routing test. Responsive layout at 375, 390, 768, 1024, 1440
and 1920 has NOT been measured in a browser (no admin session was available). The escaped `or`
clause is verified at string level against PostgREST's documented quoting rules and the
postgrest-js source, not against a live PostgREST. The suspension and delete behaviours in
findings 37-39 are read from the handlers, not exercised.
