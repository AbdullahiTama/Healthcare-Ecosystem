# CareFind admin redesign

Design: `docs/superpowers/specs/2026-10-12-carefind-admin-phase1-design.md`.
Code: `apps/carefind/src/modules/admin/`.

## Phases

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: `AdminProvider`, shell and topbar, Overview with Needs attention | built (PR #22) |
| 2a | Trust queues: Verification, Claims, Reports, Moderation | built (PR #23) (Verification, Claims, Reports, Moderation) |
| 2b | People: Users, Businesses | built (PR #24) (Users, Businesses) |
| 3 | Finance: Revenue, Withdrawals, Orders, Money checks | built (PR #25) (Revenue, Orders, Withdrawals, Money checks) |
| 4a | Content: Posts, Stories, News, Promotions | built (PR #26) (Posts, Stories, News, Promotions) |
| 4b | Live: Go live | built (PR #27) (Go live) |
| 5a | Insight: Alerts, Audit log, Searches, Drug intel, Errors | built (PR #28) (Alerts, Audit log, Searches, Drug intel, Errors) |
| 5b | System: Teams, staff and roles, Tasks | built on `feat/carefind-admin-phase5b` (Teams & Staff, Sponsored Tasks) |
| 5c | System: Shop, Email templates; delete `legacy/` and the dead hooks | not started |

## How the code is organised

```
AdminPanel.jsx             AdminProvider > AdminShell > active section
provider/AdminProvider.jsx session verify, permissions, toast, confirm, realtime, sign-out
shell/                     AdminNav, Topbar, AdminShell (uses the design-system DashboardShell)
navigation.js              the nine groups; every tab key lives here once
sections/                  redesigned screens (OverviewSection, FeedRankingSection,
                           VerificationsSection, ClaimsSection, ReportsSection, ModerationSection,
                           UsersSection, BusinessesSection, RevenueSection, OrdersSection,
                           WithdrawalsSection, MoneyChecksSection, PostsSection, StoriesSection,
                           NewsSection, PromotionsSection, GoLiveSection, AlertsSection,
                           AuditLogSection, SearchesSection, DrugIntelSection, ErrorsSection)
legacy/LegacyTabHost.jsx   screens not yet redesigned, with the props they always had
lib/attention.js           the one builder for the Needs attention queue
hooks/useOverviewData.js   Overview data, one settled result per source
hooks/useTrustQueues.js    verification, claim and report lists, one settled result per source
hooks/useReviewActions.js  approve/reject/resolve actions and the credential viewer
hooks/useUsersDirectory.js      Users page: server-side search and paging, exact total
hooks/useBusinessesDirectory.js Businesses page: same, via the transport
hooks/useUserActions.js         verify, suspend and delete a user
hooks/useFinanceData.js        transactions and withdrawals, one settled result per source
hooks/useReconciliation.js     money check findings, decisions and "run now"
hooks/useWithdrawalActions.js  reject a withdrawal, refreshing the list on every outcome
lib/uploadMedia.js         uploadToBucket: returns an upload failure instead of ignoring it
hooks/usePostsDirectory.js     Posts page: server-side search, filters and paging
hooks/useContentLists.js       stories, news and promotions lists; a failed load is an error
hooks/useNewsActions.js        approve, reject and delete news, one refresh per action
hooks/useContentActions.js     create and delete stories and promotions
hooks/useLiveShows.js          live and scheduled shows, one settled result per source; realtime plus a 15 s poll
hooks/useLiveControl.js        one show's control room (items, comments, stats), per show; realtime plus a 10 s poll
hooks/useLiveActions.js        start, schedule, end, post, hide; upload failures stop the action; per-action in-flight guard
hooks/useGuestSearch.js        server-side guest search for a live show (debounced)
hooks/useAuditLog.js           audit log page: server-side action, type and date filters, paging by growing `limit`
hooks/useSearchAnalytics.js    the newest 300 searches; a failed read is an error
hooks/useAlerts.js             seven alert sources, each settled on its own, built by lib/buildAlerts
hooks/useDrugReviews.js        explicit drug search; a late result never overwrites a newer one
lib/buildAlerts.js             the alert derivation (legacy titles, severities, tab and role keys) plus `failed` labels
lib/searchTally.js             `tallyTerms` (top 12) and `demandGaps` (top 15)
sections/live/                 LiveShowCard (control room), ScheduledShowCard, StartShowPanel, mediaUrl
lib/financeFormat.js       the legacy money maths (revenue, top-ups, coins to naira, masking), pinned by tests
lib/bulkModeration.js      runBulk: bulk actions act only on the types their labels name
repositories/transport.js  `or` filter op (every term quoted and escaped) and `likeContains`
ui/                        MetricStrip, SplitBar, ReviewQueue, ReviewDrawer, DirectoryTable,
                           useDebounced, admin.css (admin-scoped tokens)
```

The section list in the legacy host no longer includes the four trust tabs
(Verification, Claims, Reports, Moderation) or Users and Businesses, and the host no
longer holds Users or Businesses state. The Go live guest picker now searches server-side, so
`users` is no longer destructured in `LegacyTabHost`; no screen reads the businesses or phone data from it any more. The Finance tabs (Revenue, Orders, Withdrawals, Money checks) have left the host too. `transactions`
and `withdrawals` still come from `useAdminData` for the Overview and notifications, while the Finance
screens read through `useFinanceData`. `components/StatusDot` and `RowActions` remain because
`ShopTab` uses them. The Content tabs (Posts, Stories, News, Promotions) have left the host too (af62a42).
`LegacyTabHost` now holds only the Phase 5 tabs. `ModerationProvider` is no longer
mounted by the host; `AdminPanel` mounts it only around the Moderation section. The legacy hooks
`useAdminStories`, `useAdminNews` and `useAdminPromotions` in `hooks/queries.js` remain: the shell
uses `useAdminNews` for the session-expired toast, and Phase 5 retires the rest. The Content
screens read through `useContentLists`.

Go live (Phase 4b) has left the host too (7e8d30b): `tabs/GoLiveTab.jsx` is deleted, along with the
host's twelve live state variables, every live handler and the `useAdminLiveShows` call.
`useAdminLiveShows` in `hooks/queries.js` has no consumers now and is dead code until Phase 5.
The shared recorder and uploader components (`VoiceRecorder`, `SlideUploader`, `VideoRecorder`,
`VideoUploader`) are unchanged (finding 72).

Phase 5a moved the insight tabs out of the host (commits bfb0343 through 51d2f8e): Alerts (route
key `notifications`), Audit log, Searches, Drug intel and Errors. `LegacyTabHost` now holds only Tasks,
Teams, Shop and Email templates (5b and 5c). Deleted: `tabs/DrugsTab.jsx`, `SearchesTab.jsx`,
`NotificationsTab.jsx`, `ErrorsTab.jsx` and `components/AuditLog.jsx`. Removed from the host: the six
drug state variables, `searchDrugs`, the `commerceRepository` import and the `useAdminSearchLogs` call.
Left in place on purpose:

- `useAdminSearchLogs` in `hooks/queries.js` has no consumers: dead code until 5c.
- The `notifications` derivation still also lives in `useAdminData` (`queries.js`, ~line 925) and in
  `dashboardRepository.getNotifications` (finding 6); `useAdminData` is still read by Teams, Tasks and
  Shop, so the block goes with 5b/5c. `lib/buildAlerts.js` is now the Alerts screen's builder.
- `LegacyTabHost`'s `setTab` prop is unused now (only the deleted Notifications tab used it);
  `AdminPanel` still passes it. Drop it in 5b or 5c.

Phase 5b moved Teams and Tasks out of the host (commits cbf8b31 through 9f4e1af on
`feat/carefind-admin-phase5b`). New code:

```
hooks/useTeamsData.js      teams, admin roles and staff, each settled on its own to ok / error
                           (stale keeps the last data); staff is { status: 'restricted' } without a call
                           for a non-super admin
hooks/useStaffActions.js   create/deactivate/reactivate/change-role staff, create team, create/update/delete
                           role: audit entries, one refresh, per-key in-flight guard
hooks/useTasksData.js      useTasksData (the list) and useTaskActions (createTask with validation)
lib/capped.js              the shared refresh-wait cap (10 s); also used by useLiveActions now
lib/normName.js            the server's role-name rule (lower-case, whitespace to underscore; the client also trims)
ui/PermissionMatrix.jsx    the section checkbox grid shared by create-role and edit-role
sections/TeamsSection.jsx, sections/TasksSection.jsx
sections/teams/            TeamsPanel, StaffDirectory, CreateStaffPanel, RolesPanel, SourceNotice, roleNames
```

`LegacyTabHost` now holds only Shop and Email templates (5c). Deleted: `tabs/TeamsTab.jsx` and
`tabs/TasksTab.jsx`. Removed from the host: the task, team, staff and role state, `createTask`,
`createStaff`, `createTeam`, and the `useAdminData` and `useAdminRoles` calls. Left in place on purpose:

- `useAdminRoles` in `hooks/queries.js` has no consumers: dead code until 5c.
- `useAdminData` still fetches tasks, teams and staff; `AdminShell` and `ModerationSection` still read it.
- Already-unused leftovers in `LegacyTabHost` (not caused by 5b): `useEffect`, `adminPermissions`,
  `askConfirm`, the `setTab` prop (`AdminPanel` still passes it), `dateFrom`/`dateTo`, the `ecom*`
  variables, `updateEcomApp` and `moderateProduct`. Its header comment still describes the host as
  holding screens with their state and handlers, which is now only true of Shop and Email templates
  (they receive just `showToast`).

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

45. Revenue's "Total Revenue", "Top-ups" and "Withdrawals" figures were computed from only the
    latest 50 transactions (`list_transactions` has `limit(50)`, all types and statuses), and the
    top-up sum ignores `status`; they are not totals. **Labelled** (the cards now say "(latest 50)"
    and "of any status"); the calculation is unchanged and pinned by the `financeFormat` tests
    (1b5759e, c94f7af).
46. Revenue divides `naira_amount` by 100; Orders shows the same field undivided. One of them is
    wrong by 100x. Left as is on both and labelled ("Amount as stored"); needs the backend and
    finance owner (c94f7af, d59cf35). Display only: Revenue's ₦ column shows "—" when
    `naira_amount` is 0 or missing; the legacy tab rendered a stray "0" for 0.
47. "Orders" lists wallet transactions (the same 50 rows), not shop orders, and sits under
    Marketplace in navigation. Documented.
48. Withdrawals converts coins to naira with a fixed 200 per coin in the UI (`nairaFromCoins`).
    Now labelled "about ₦X at 200 per coin" (ddc5f42).
49. `list_transactions` and `list_withdrawal_requests` are readable by any valid admin token
    (finding 1 applies to money data); hiding the tabs is cosmetic. Money data is read through the
    same endpoints as before. `reject_withdrawal` itself also only checks `verifyToken`
    (`admin-auth.js` ~345-347), so per finding 1 roles are not enforced on the money action
    either: any admin role can reject a withdrawal. Documented.
50. The legacy withdrawal reject toasted any server error and did not refresh, although a 409
    "confirmed paid" had already settled the request. **Fixed**: the new action refreshes the list
    on every outcome (010eb04; a late result can no longer land on a different open drawer, 1a70b26).
    A refusal that arrives after its drawer was closed or replaced is toasted ("Couldn't reject the
    withdrawal: …") instead of being dropped, and a refresh or toast that throws after the server
    committed no longer reports the reject as failed (this wave's fix commits; see finding 55 on
    audit).
51. Account numbers were shown in full in the list. **Fixed**: the Withdrawals table shows the last
    four digits and the drawer the full number (ddc5f42). The drawer shows only the fields the
    legacy screen showed (person, amount, bank, account number and name, status, requested); the
    Paystack reference is not shown.
52. `reject_withdrawal` can record a request as PAID (Paystack says the transfer succeeded) while
    returning HTTP 409, refund it, or block it (`decideAdminReject`; `admin-auth.js` ~344-383). The
    legacy "Reject and refund" label promised a refund that happens in only one of the three
    outcomes. **Fixed**: the button is now "Reject withdrawal" and the confirmation states the
    outcomes (5439a32). Follow-up: the server should return a distinguishable code for the
    settled-as-paid case so the drawer can show it as information, not an error.
53. Orders' status badge uses `StatusBadge`, which has no `success` entry, so a `success` row shows
    as a gray pill where legacy coloured it green. Display only; the fix belongs in the design
    system. Documented.
54. The shared `ReviewQueue` labels its tabs Pending and All, so for withdrawals "Pending" means in
    progress (`reserved` or `processing`). The empty message says "Nothing in progress". Documented.
55. No audit row or action history is written for the withdrawal reject, the most consequential
    admin money action, before or after this phase (`useWithdrawalActions` matches the legacy
    handler). Owner follow-up recommended: the server should write the audit row in
    `reject_withdrawal`, so it cannot be skipped by a client. Also recorded:
    - A failed list refresh after a reject hides the drawer (and the message in it) until the list
      recovers. This is shared `ReviewQueue` behaviour (the selection is kept and the drawer comes
      back with the row). A refusal whose drawer is already hidden this way is toasted.
    - The Money checks Retry button gives no feedback while retrying: react-query keeps `isError`
      true during the refetch, so the error and Retry stay on screen until it settles.

56. Story and promotion image uploads (and the scheduled-show trailer and live-image uploads)
    ignored a failed upload (`if (!upErr)`): the item was created without its image, the show
    scheduled without its trailer, or the live image dropped (and cleared from the form), with no
    message. **Fixed** for stories and promotions (e734b52, 8ff72d5, 6f416a3, aa68240): a failed
    upload now stops creation, shows the error and keeps what the admin typed. The live paths
    (`LegacyTabHost.jsx` ~102 and ~210) are Phase 4b.
57. Posts loaded the newest 50 posts and filtered them in the browser (same blind spot as Users,
    finding 29). **Fixed** (7d963bf, 700f208) with the `list_posts` server-side filters and
    paging; the posts total shows only when unfiltered.
58. `useAdminNews` turned any non-auth error into an empty list, and stories and promotions
    defaulted to `[]` on failure, so a failed load looked like "no news submissions yet".
    **Fixed** in the new hooks (1186d48): failures are errors and show Retry.
59. `list_news` (`apps/carefind/api/_handlers/admin-auth.js` ~697-709) ignores its query error
    and returns `[]`, is capped at 60 rows (shown as a cap note), and returns submitter phone
    numbers taken from verification requests. Documented, not changed.
60. Uploads go straight from the browser to storage buckets (`story-images`, `promo-images`);
    the trust boundary is the bucket policies, not the admin API (Phase 1 finding 11).
    Documented.
61. The legacy news handlers edited the query cache optimistically and called `invalidateAdmin()`
    twice; replaced by one refresh (036d9ac). Also: the legacy Reject on a news item did not ask
    for confirmation; it does now (1242e9f). Failed creates keep the form.
62. `approve_news` (`admin-auth.js` ~509-522) spreads the client's `edits` object straight into
    the update (`...(edits || {})`), so any valid admin token can write arbitrary columns of a
    news row (for example `author_id` or `status`) through it; the UI only sends `headline`,
    `subtitle` and `body`. Backend; documented, not changed. Approving PUBLISHES the item
    (status approved and `published_at`), so the button is now labelled "Approve and publish".

63. `exportCSV` (`ui/adminHelpers.js`) writes cell values as given (JSON-quoted) without
    neutralising spreadsheet formulas, so a user-supplied value beginning with `=`, `+`, `-` or
    `@` (a post's text, a name) can run as a formula when the file is opened in Excel or Sheets
    (CSV injection). It applies to every CSV export (6 callers: Users, Businesses list and
    per-business data, Posts, Revenue, Drugs). Documented, not
    changed; the fix is to prefix such cells with `'` in the one shared helper.
64. Each retry of a failed story or promotion create uploads a NEW file to `story-images` /
    `promo-images` under a new timestamped name, and a successful upload followed by a failed
    create leaves that file orphaned in the bucket. Nothing cleans these up. Documented, not
    changed (a cleanup needs a server-side delete or a lifecycle rule on the buckets).

Phase 4a follow-ups and final-review corrections (fix commits 22e511b, 8359054, 77967e6):

- Neither the News "Submitted" column (the server returns the newest 60 only) nor the Posts
  "Posted" column is sortable: a sort would reorder only the rows on screen (finding 44). **Fixed**
  for Posts (22e511b), which sorted its 25 rows before. A real sort needs an `order` parameter on
  `list_posts`.
- The shared `DateRange` labels (From, To) in `ui/FilterPills.jsx` were not linked to their
  inputs. **Fixed** (22e511b): each label is linked by a `useId` id, which also gives `DrugsTab`'s
  date inputs accessible names.
- Posts media: `<img>`, `<video>` and `<audio>` get a `src` only for an http(s) URL; any other
  address shows "Unsupported media address" (22e511b).
- News: as in the legacy tab, an item that was rejected (anything not yet approved) can still be
  approved and published from its drawer under All; Edit and Reject are offered only while
  pending, Delete always (8359054). The Reject confirmation says so.
- News: the approve audit entry records the item's ORIGINAL headline, as legacy did, even when
  the admin edited it (`approveNews({ originalHeadline })`, 8359054).
- News contact links are built safely: the email is a `mailto:` link only for a single plain
  address (no whitespace, exactly one `@`, no `,` or `;`), so `,`/`;` cannot add recipients;
  anything else is shown as text. The link keeps `@` literal and encodes `?`, `&`, `#`, `%`, `,`,
  `;` and whitespace, so an address cannot add cc/subject/body headers (8359054, 05159d4).
  `tel:` is the value stripped to `+` and digits, and no link is shown when nothing remains.
- Stories and Promotions toast a create or delete failure that arrives after the admin left the
  tab, instead of dropping it (77967e6).
- `useAdminStories` and `useAdminPromotions` in `src/hooks/queries.js` now have no consumers (the
  new `useContentLists` replaced them). Dead code until Phase 5 removes it.
- `usePostsDirectory` and the post-author query in `PostsSection` call `callAdminAuth` directly
  rather than through a repository, because the repositories turn failures into `|| []` /
  `|| null`, which would show a failed load as an empty list or an unknown user. Phase 5 should fix
  the repositories (reject on failure) rather than copy this bypass.
- Live story rows no longer show legacy's "Expires in X"; they show Live or Expired plus the age.
  The remaining time is derivable from `expires_at` if wanted back.
- The Stories and Promotions sections do not validate the chosen file's type or size (the input
  only hints `accept="image/*"`); the bucket policy is the boundary (finding 60).

Phase 4b (Go live; commits 3336ff8 through b0dcc00 on `feat/carefind-admin-phase4b`):

65. `useAdminLiveShows` defaulted a failed read to `[]`, so a failed read looked like "no live
    shows" and the admin could not see or end a live show. **Fixed** in `useLiveShows` (899842f,
    89faeab): each source settles on its own and a failure shows "Couldn't load" with Retry.
66. The control room loaded once on a button press and never refreshed (stale comments and stats
    during a show), shared one set of state across all live shows, and had no error handling
    (`loadLiveControl` was an unhandled rejection on failure). **Fixed** (a254fe2, 20dbe18):
    `useLiveControl` is per show, subscribes to `live_comments` and `live_items` and polls every
    10 s, and a failed refetch keeps the last good data with an inline Retry. The "Updated
    HH:MM:SS" stamp only moves on a successful load, so a failed refetch cannot make stale data
    look fresh. The control room is open on every live card (no "Load Control Room" button).
67. A failed trailer upload scheduled the show without its trailer, and a failed live-image upload
    dropped the image and cleared it from the form, silently. **Fixed** (115e014): either failure
    stops the action, makes no server call, shows the error and keeps the form or draft. These are
    the live half of finding 56.
68. The guest picker filtered the newest 100 users in the browser and showed 30. **Fixed** (c399161)
    with a debounced server-side `list_user_profiles` search (20 results; characters that break
    the PostgREST `or` filter are replaced by spaces first, as in finding 30).
69. Nothing stopped starting a second live show, and "Go live now" and "Start now" had no
    confirmation although they publish a LIVE indicator to every user. **Confirmations added**
    (3aa722c); "Go live now" also states how many other shows are already live. Starting a
    second show is still allowed.
70. The realtime subscriptions (`live_shows`, `live_comments`, `live_items`) run through the
    admin's browser Supabase session and may be silently filtered by row level security (a
    channel can connect and deliver nothing). A poll runs alongside realtime for that reason
    (`pollAlways`: 15 s for shows, 10 s for the control room). Unverified without an admin
    session.
71. The gifts figure sums `gifts.coins` where `post_id = showId` through the browser client
    (money-adjacent; kept as legacy; RLS could make it read low). Documented, not changed.
72. The shared recorder and uploader components (`VoiceRecorder`, `SlideUploader`,
    `VideoRecorder`, `VideoUploader`) ignore the result of their callback and do not catch a
    throw, so when `postMedia` fails they still show the item as sent. **Mitigated** in the live
    card (6455f45, f192904): a persistent, named, dismissible "Couldn't post <label>" failure list.
    A failed slide is named by its page ("Slide 3 of 8") and clears when the same slide later
    succeeds; voice and video attempts are numbered per card ("Voice note 2") and clear only on
    Dismiss. Not fixed at the source because the components are shared with the live session and
    the feed.

Phase 4b behaviour changes from legacy:

- "Go live now" and "Start now" ask for confirmation (finding 69); End and Cancel keep their
  legacy confirmations.
- A failed trailer or live-image upload stops scheduling or posting (finding 67). If an image
  posts but its text then fails, only the text draft is kept.
- Every live card has its control room open, per show, kept live by realtime plus polling
  (findings 66, 70).
- Failed lists show Retry, never empty text; the empty cases are stated plainly ("No live shows
  right now", "No scheduled shows").
- `useLiveActions` has a per-action in-flight guard (key `action:target`, covering uploads): a
  repeat of the same action on the same target is refused ("Already running") with no server
  call, while different actions (for example hiding a comment during a slide upload) can run
  together (fdf9dd1). A media post is keyed by show and content, so a second distinct item posts
  while one is in flight and only a true duplicate (same show and content) is refused. The key is
  held until the server call and the list refresh have both finished (`invalidateAdmin` returns
  its promise and `bestEffort` awaits it without ever failing the action), so End show, Start now
  and Cancel cannot be clicked again while the card is still on screen. Posting and hiding
  refresh only that show's control room (`['admin','live','control',showId]`; `hideComment`
  takes an optional `{ showId }` and falls back to a full refresh without it); start, schedule,
  end and cancel still refresh all admin data.
- A failed refresh of the shows list keeps the cards on screen: when a source last loaded fine
  and the new read fails, `useLiveShows` returns `{ status: 'ok', data: <previous>, stale: true }`
  and the section shows "Couldn't refresh live shows" / "Couldn't refresh scheduled shows" with
  Retry above the cards (composer drafts, the failed-media list and End show survive). A first
  failure is still a plain error, a later success drops `stale`, and a stale live list still
  counts toward the live total. Realtime and poll refreshes pass `cancelRefetch: false`, so they
  no longer cancel a load in progress.
- A stale list that is empty still shows the "Couldn't refresh" warning with Retry above the
  empty text, so "No live shows right now" is never shown alone after a failed refresh. While
  the live list is stale the section passes `liveCount` as `null` (the last-known number is not
  trusted), so the confirmation says it could not check.
- The wait for the list refresh is capped at 10 s (`Promise.race` with a timer cleared when the
  refresh settles first): after the cap the guard key is released and the action's result is
  unchanged.
- The Go live confirmation names the number of other live shows; when the live list could not be
  read (failed or still loading) the section passes `liveCount` as `null` and the confirmation
  says "Couldn't check how many shows are already live." instead of implying none. The started
  toast reads "Live show started. Its control room is under Currently live."
- The legacy `postLiveItem` read `admin_token` from `localStorage`, which never sent a token. The
  read is dropped; calls go through `callAdminAuth` like every other action.
- Media in the control room and on scheduled shows is shown only for http(s) URLs (308801f).
- Unchanged and unaudited: as in legacy, Phase 4b records no audit entries for live actions
  (start, schedule, end, cancel, post, hide). Documented gap, not changed.
- `uploadToBucket` gained an optional `{ contentType }` (3336ff8), used for the trailer.

Phase 5a (insight tabs; commits bfb0343 through 51d2f8e on `feat/carefind-admin-phase5a`):

73. The Errors tab called `list_errors` and `resolve_error`, which exist nowhere in
    `apps/carefind/api/_handlers/admin-auth.js` (grep finds neither action name in `api/` or `src/`
    outside the replaced screen's comment). It could only ever show a load error, which could pass for
    an empty inbox. **Replaced** (6476d27) by an honest unavailable state ("The error inbox isn't
    connected yet") that makes no network call (the test spies on `callAdminAuth` and `fetch`).
    Building the backend is separate work that needs approval.
74. The audit log, searches and alerts turned a failed read into an empty list ("No audit log
    entries", "No searches yet"), and Alerts could say "All clear" while a source could not be
    checked (it was built from `useAdminData`, finding 3). **Fixed** (bfb0343, 5fb2410, 29265f3)
    for failures the client can see: each such failure is an error with Retry, and Alerts reads seven
    sources independently. Failures the server swallows are not visible to the client; see the known
    limits below, which is why Alerts no longer says "All clear".
75. The audit log loaded the newest rows and filtered them in the browser although
    `list_audit_logs` filters `action`, `target_type` and dates on the server, and the search
    analytics tally only the newest 300 searches while presented as overall. **Fixed** (bfb0343,
    48def17): the filters go to the server, and the screens state their windows. The endpoint has no
    offset, so page N asks for the first (N+1)*25+1 rows, capped at 200 by the client (the server
    uses `limit(lim || 100)` and has no cap of its own); at the cap the screen says "Showing the
    newest 200 entries" and older rows cannot be reached from it.
76. `list_audit_logs` and `list_search_logs` only check that the token is valid, not the admin's
    role, so any signed-in admin can read the audit trail and all search text (finding 1). Also,
    `list_search_logs` ignores its query error and returns `[]` (as findings 27 and 59 describe for
    other lists), so a failed query reaches the client as an empty window and the client cannot tell.
    Documented, not changed (backend out of scope).
77. Drug intel searched products by name (`searchProducts` returns at most 5), named only the FIRST
    match, and loaded the reviews of ALL matches, so the heading could name one product over the
    reviews of others; a failed lookup was not handled. **Fixed** (a25a4f0, 2c53b40, 73eec35): the
    reviews are still pooled across all matching products, as legacy did, and the screen now says so
    ("Reviews for N products matching “<term>”", "Reviews from all N matching products are
    combined"; a single match is named). Filters reset when a different term is searched, a failed
    search shows Retry (never "No medication matches"), and reviews without a numeric rating are
    listed but excluded from the sentiment counts and the average (a null rating used to count as
    negative).
78. The legacy audit and error tabs sent `localStorage.admin_token` in the payload (a dead field,
    see finding 10). Dropped; the new hooks send no `token`.
79. The withdrawal alert converts `amount * 200` to naira with a hard-coded rate in the client
    (`lib/buildAlerts.js`; the same maths is in `hooks/queries.js`,
    `dashboardRepository.getNotifications` (finding 12) and `repositories/index.js:202`, the
    `Withdrawal: ₦${(w.amount * 200)…}` row). **Kept exactly as legacy** (financial
    maths not changed). The rate is duplicated rather than sourced: the client repeats `200` in
    several places (`financeFormat.nairaFromCoins`, `NAIRA_PER_COIN` in `subscriptions.js` and
    `consultations.js`, `COIN_VALUE_NAIRA` in `Wallet.jsx`), while the server reads `coin_value_kobo`
    through `getFinancialConfig` (seeded as 20000 kobo in
    `supabase/migrations/carefind_20261003_payment_intents_foundation.sql`). If that config value is
    ever changed, this alert and the Withdrawals screen would not follow it. Reported only; whether
    the live row still holds 20000 was not checked.

Phase 5b (system tabs; commits cbf8b31 through 9f4e1af on `feat/carefind-admin-phase5b`):

80. The Teams tab created custom-role staff with the role name only; `role_id` stayed NULL. Whether access
    follows the name or the id is decided by `get_admin_permissions`, which is not in the repository's
    SQL as the handler calls it (see finding 88), so the effect on custom-role staff is unverified. The
    screen now sends `roleId` for custom roles.
81. `toggle_staff` and `assign_admin_role` existed with no UI, so a staff member could not be deactivated
    or moved to another role from the console. **Wired**, each behind a confirmation. Verified in the
    code: `requireAdmin` runs at the top of the handler and rejects an inactive admin (403) on every
    request, so a deactivated admin is refused on their next call; `toggle_staff` itself only updates
    `is_active` and does not revoke the Supabase session; `delete_admin_role` deletes only the role row
    (it refuses system roles and does not touch `admin_users`).
82. `list_staff` is super-admin only but its failure was turned into `[]`, so a non-super admin with the
    Teams permission saw "No members yet" for every team. **Fixed in part**: the Teams section shows an
    explicit restricted state and makes no `list_staff` call for a non-super admin (`AdminShell`'s
    `useAdminData` still requests it for every admin), and "No members yet" is said only when staff
    really loaded and the rows carry team ids (finding 91).
83. `create_staff` accepts any `newRole` string including `super_admin`, and `update_admin_role` has no
    `is_system` check, so a super admin can edit a system role's permissions. The UI offers neither; the
    server still allows both (documented, not changed).
84. Staff, team and role changes wrote no audit entries. **Added** (best effort, never the password or the
    person's name).
85. The password for a new staff account is chosen by the super admin and sent in the request body; there
    is no invite or forced-reset flow, and the server enforces no password policy. A client minimum of 8
    characters was added; the policy gap is documented.
86. Task submissions have a list action (feeding Alerts) but no approve/reject action or screen, and no
    task edit or close action exists. Tasks can only be created and listed; the screen says "Task
    submissions can't be reviewed from the console yet." Needs a backend decision.
87. `assign_admin_role` sets `admin_users.role` to the role row's NAME, so assigning the system
    `super_admin` role would promote a staff member to super admin. The console never offers it and
    `assignRole` refuses it; the server enforces neither.
88. Permission maps. The console's `isAllowed` treats any section key that is not `false` as allowed, and
    the legacy create/update role wrote only the checked keys, so a role created in the legacy screen has
    its unchecked sections allowed in the console UI. The new screens send a complete explicit true/false
    map (plus `overview: true`) and show and edit each role's EFFECTIVE access. UNVERIFIED: whether the
    server applies the same missing-means-allowed rule, and what `verify` / `get_admin_permissions`
    return. The repo SQL's `get_admin_permissions` reads `admin_role_permissions.permissions`, while the
    handlers write `admin_roles.carefind_tabs`, and no SQL in the repo defines that column. The owner
    must check the live `admin_roles.carefind_tabs` of existing custom roles and decide: treat missing as
    denied, or backfill explicit false.
89. `create_admin_role` normalises names with `toLowerCase().replace(/\s+/g, '_')`, so a role typed
    "Super Admin" becomes `super_admin`. Only a unique constraint or a seeded system row would block it,
    and whether the live system row is seeded was not checked. The client now refuses any name that
    normalises to `super_admin`.
90. As finding 83, the `create_staff` action accepts `super_admin` as `newRole`. The client refuses it in
    both `createStaff` and `assignRole` (and never offers it), but the server does not.
91. `list_staff` (`admin-auth.js`, ~line 145) selects only `id, email, full_name, role, is_active,
    last_login, created_at`: no `team_id` and no `role_id`. Every staff row therefore arrives without a
    team, so "who is on which team" cannot be shown from it. The console now treats a loaded, non-empty
    staff list in which no row has a `team_id` key as "membership unavailable": each team says "Team
    membership isn't available yet" and the staff table and drawer say "Not provided by the server" (never
    "No members yet" or "No team"). Rows that do carry `team_id` (including null) keep the normal logic.
    The owner should add `team_id` (and `role_id`) to the select; until then the console says membership
    is unavailable. The legacy tab had the same blind spot and showed false empty teams.
92. `toggle_staff` ignores the error of its update and always returns `{ success: true }`, so a failed
    activate/deactivate (for example a database error or a staff id that matches no row) reports success.
    Also `list_staff`, `list_teams` and `list_admin_roles` return `data || []` and never look at the
    query error, so the client's rule that a failed read is never shown as empty cannot hold for database
    errors on those three actions (the same family as findings 27, 59 and 76). Documented, not changed;
    the console cannot tell these cases apart.

Phase 5b behaviour changes from legacy:

- Teams & Staff reads teams, roles and staff as independently settled sources: a failed read is an error
  with Retry, never an empty list; a failed refresh keeps the data with "Couldn't refresh" and Retry. A
  non-super admin sees the teams list and one note, and nothing else.
- Staff can be deactivated, reactivated and moved to another role, each behind a confirmation. The own
  row has neither action, and the protections fail closed when the signed-in admin's id is unknown. One
  action hook serves the whole staff drawer, so deactivate and change role cannot run at the same time.
- Every action has a per-key in-flight guard (a repeat while one runs makes no second call); the guard is
  released after the refresh, capped at 10 s so a hung query cannot disable the controls for good.
- Audit entries are written for staff, team and role changes. The create-staff password lives only in the
  form's state, is cleared after every attempt, and appears in no audit entry, toast or log.
- Create staff: password minimum 8 on the client (the server has none); a failure keeps the other fields.
  `roleId` is sent for custom roles; `createStaff` trusts the caller to pass the role row matching `role`
  (the same gap as `assignRole`'s `roleName`). While the password is typed it is in the input's own
  `value` attribute (React keeps it in sync); it is never rendered as text, in a title, label or data
  attribute, and it is cleared after every attempt.
- The roles panel shows and edits each role's effective access with the shared permission grid; system
  roles are read-only; deleting a role needs a confirmation whose wording makes no claim about staff on
  it; a description-only edit sends no permissions.
- A non-super admin is not offered team creation (the form is for super admins only; the server refuses
  `create_team` for them anyway). Staff problems are alerted once: the staff directory owns the failed or
  stale alert and Retry; the teams panel says only "Members unavailable" (failed) or one note "Members
  are visible to super admins" (restricted).
- Super admins are listed with everyone else: the spec's "super admins in their own band" was dropped. A
  super admin can deactivate or demote another super admin, and the console can never promote anyone
  back (finding 87), so both confirmations then add "They can't be made super admin again from the
  console."
- A new custom role may not be named like a system role (moderator, verification_officer,
  business_manager, support_agent, analytics_manager) or super_admin once normalised: "That role name is
  reserved".
- The create-team form has the same in-flight guard as the other forms and native `required`.
- Sponsored Tasks: the compensation must be a positive whole number (legacy sent the raw field);
  validation is in both the screen and the hook; a failure keeps the form; a result that arrives after
  the screen has gone is toasted. The list is a real read (failed, empty and stale are different states).

Phase 5b known limits (not fixed):

- Task submissions cannot be reviewed and tasks cannot be edited or closed (finding 86).
- `list_teams` and `list_admin_roles` check only the token, not the role (finding 1), so any signed-in
  admin can read them.
- The in-flight tests mock the hook, so a regression to per-editor hook instances (which would defeat
  the shared guard) would not be caught by the component tests.
- There is no password reset or invite flow (finding 85).
- Heading outline: Sponsored Tasks is h1 then h2s. Teams & Staff is not a clean outline: in page order
  it is h1, an h3 per team (no h2 above them), h3 "Create staff account", h2 "Staff", h2 "Roles", h3
  "Create a role".

Phase 5a behaviour changes from legacy:

- Audit log: action, target type and dates are sent to the server; the actor filter is client-side
  over the loaded page, labelled "Actor filter applies to the rows loaded.", and when it hides every row of a loaded
  page the table says "No entries on this page match this actor..." (a new optional `emptyNote` prop
  on the shared `DirectoryTable`; default behaviour unchanged, a10687b). A server filter change returns
  to page 1. Paging and the 200-row cap: finding 75. The CSV is one flat record per row (b95e115).
- Searches states its window ("newest 300 searches") on the header and the metrics. Top terms, demand
  gaps and recent searches keep the legacy calculation (12, 15 and 40 rows).
- Alerts keeps the legacy derivation (titles, severities, tab and role keys) but builds it from
  independently settled sources. If any could not be read it says "Couldn't check: <labels>" with
  Retry and never "All clear"; it can still list alerts from the sources that loaded. With none pending
  it says "Nothing pending in the sources checked" (or "...in the sources that loaded" when some
  failed; nothing at all when every source failed), with the hint "Some reads can't report their own
  failures; this reflects what the server returned." A card for a tab the role cannot open
  renders without a link and says "Not available to your role" (UI courtesy only; the server decides).
- A failed refresh of already loaded Searches or Alerts data keeps the data and shows "Couldn't
  refresh, showing the last loaded data" with Retry (1303ce1). A first failure is a plain error.
- Drug intel searches on the button or Enter (not per keystroke); see finding 77. Its CSV is flat and
  is named after the product (or the search term when several products matched).
- Errors makes no network call (finding 73).
- No audit entries are written by these screens: they are read-only and perform no actions.

Phase 5a known limits (not fixed):

- The shared `exportCSV` (`ui/adminHelpers.js`) writes cells with `JSON.stringify`, so quotes are
  escaped as `\"` rather than doubled as RFC 4180 requires, and it has no spreadsheet formula guard.
  This extends finding 63: the audit log CSV (actor names, metadata text) and the drug intel CSV
  (review comments) are two more callers exposed to CSV injection, and a cell containing a quote may
  parse wrongly in a strict reader. The one shared helper is the place to fix both.
- The shared `MetricStrip` error cell always reads "Couldn't load · Retry", so two failed cells (for
  example Searches' two) are indistinguishable to a screen reader. Needs a per-cell accessible name
  in the shared component.
- The audit action filter list is the legacy one (approve, reject, delete, suspend, resolve and the
  three bulk verbs); a recorded verb outside it is visible only under "All actions". The actor shown
  is `admin_users.full_name`, or "Admin" when the server could not resolve it.
- Alerts cannot detect failures that five server actions swallow in
  `apps/carefind/api/_handlers/admin-auth.js`: `list_reports`, `list_withdrawal_requests`,
  `list_task_submissions`, `list_business_claims` and `list_news` ignore their query error and return
  `200 {data: []}`. Withdrawals and task submissions are new findings here (reports, claims and news
  are findings 27 and 59 for other screens). A failed read of these shows as nothing pending, so the
  screen only claims what the server returned. Server windows: reports are the newest 30 across all
  statuses, task submissions 20, news 60, and consultations the newest 20 with status `paid`
  (`dashboardRepository.getProfessionalConsultations`); withdrawals and claims have no limit. An old
  pending item outside a window is not alerted.
- The audit log's failed-load text is `DirectoryTable`'s generic "Couldn't load this list.", a
  deliberate deviation from the spec's "Couldn't load the audit log".
- Alerts' `notifications` derivation also still lives in `useAdminData` until 5b/5c; the dead
  `useAdminSearchLogs` and the unused `setTab` prop are listed under How the code is organised.

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

Phase 3: unit and component tests cover `financeFormat`, `useFinanceData`, `useReconciliation`,
`useWithdrawalActions`, `RevenueSection`, `OrdersSection`, `WithdrawalsSection`,
`MoneyChecksSection` and the panel routing test. The money figures are pinned to the legacy
maths by tests. Responsive layout at 375, 390, 768, 1024, 1440 and 1920 has NOT been measured in a
browser (no admin session was available). The Paystack reject outcomes are read from the code
(`decideAdminReject`, `decideTransferAction`, `reject_withdrawal`), not exercised.

Phase 4a: unit and component tests cover `uploadMedia`, `usePostsDirectory`, `useContentLists`,
`useNewsActions`, `useContentActions`, `PostsSection`, `StoriesSection`, `NewsSection`,
`PromotionsSection` and the panel routing test. Responsive layout at 375, 390, 768, 1024, 1440
and 1920 has NOT been measured in a browser (no admin session was available). Uploads were never
exercised against real buckets (the storage client is mocked). The server handlers' behaviour
(`list_posts`, `list_news`, `approve_news`) is read from the code, not exercised.

Phase 4b: unit and component tests cover `uploadMedia` (contentType), `useLiveShows`,
`useLiveControl`, `useLiveActions`, `useGuestSearch`, `LiveShowCard`, `ScheduledShowCard`,
`StartShowPanel`, `GoLiveSection` and the panel routing test. At 7e8d30b the admin suite
(56 files, 737 tests) passed. After the final-review and re-review fixes (b0dcc00) the admin suite is 57 files, 757 tests, the build succeeds and lint reports 0 errors. Responsive layout at
375, 390, 768, 1024, 1440 and 1920 has NOT been measured in a browser (no admin session was
available). Realtime and live-show behaviour has NOT been exercised against a real show (the
realtime hook is mocked in the tests), and uploads were never run against the real `live-media`
bucket (the storage client is mocked). The Retry and aria labels, the failure list and the
confirmations are only unit-tested.

Phase 5a: unit and component tests cover `useAuditLog`, `useSearchAnalytics`, `searchTally`,
`useAlerts`, `buildAlerts`, `useDrugReviews`, `AuditLogSection`, `SearchesSection`, `AlertsSection`,
`DrugIntelSection`, `ErrorsSection`, the `DirectoryTable` `emptyNote` prop and the panel routing test
for the five tabs. At 51d2f8e the admin suite (68 files, 898 tests) passed, the build succeeds and
lint reports 0 errors. The full vitest suite has NOT been run for 5a. Responsive layout at 375, 390,
768, 1024, 1440 and 1920 has NOT been measured in a browser (no admin session was available).
Behaviour against production data has NOT been exercised: the audit paging and its 200-row cap, the
server filters, the seven alert sources and the drug search are read from the code and tested with
mocked transports, not run against the live backend.

Phase 5b: unit and component tests cover `useTeamsData`, `useStaffActions`, `useTasksData` and
`useTaskActions`, `capped`, `normName`, `PermissionMatrix`, `TeamsPanel`, `StaffDirectory`,
`CreateStaffPanel`, `RolesPanel`, `SourceNotice`, `TeamsSection`, `TasksSection` and the panel routing
test for the two tabs. At 7cec1e8 the admin suite (83 files, 1142 tests) passed, the build succeeds and
lint reports 0 errors. The full vitest suite has NOT been run for 5b. Responsive layout at 375, 390, 768,
1024, 1440 and 1920 has NOT been measured in a browser (no admin session was available). Behaviour against
the live admin has NOT been exercised: the staff and role actions, the confirmations and the audit entries
are tested with mocked transports. Custom-role access resolution (finding 88) has NOT been verified.
