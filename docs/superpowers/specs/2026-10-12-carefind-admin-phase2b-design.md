# CareFind admin Phase 2b: Users and Businesses

Date: 2026-10-12
Builds on: Phase 2a (`2026-10-12-carefind-admin-phase2a-design.md`, PR #23, branch `feat/carefind-admin-phase2a`).
Branch: `feat/carefind-admin-phase2b`, based on the Phase 2a branch.

## Goal

Move Users and Businesses out of `legacy/LegacyTabHost.jsx` into redesigned directory
screens with server-side search, filters and paging, and a detail drawer. The current
screens load the newest 100 rows and filter them in the browser, so a user or business
outside the newest 100 cannot be found, and the "N total users" header shows the loaded
count.

## Scope and constraints

- No backend, SQL, auth or financial change. Users use the existing `list_user_profiles`
  parameters (`search`, `verified`, `specialty`, `limit`, `offset`). Businesses use
  `adminTransport.query` as the legacy tab's data layer already does.
- Same `callAdminAuth` actions and payloads for `manual_verify`, `suspend_user`,
  `delete_user`, with the same audit and action-history writes.
- No UI-only permission check presented as security. The server decides (Phase 1
  finding 1). `AdminPanel`'s `isAllowed` gate still covers both tabs.
- A source that fails to load shows as failed, never as an empty list or zero.
- `users`, `businesses` and `phoneMap` stay in `useAdminData`: Go Live and other legacy
  tabs still read them.

## Units

| Unit | Responsibility |
|---|---|
| `repositories/transport.js` | New `or` filter op: `{ op: 'or', terms: [{ col, op: 'ilike', val }, ...] }`, built into one PostgREST `or(...)` string. Values are double-quoted with `"` and `\` escaped, and `%`, `_` escaped in `ilike` terms, so a search term can never change the filter. Existing ops unchanged. |
| `hooks/useUsersDirectory.js` | react-query key `['admin','users', params]`; params `{ search, verified, specialty, page }`. Calls `list_user_profiles` with `limit = pageSize + 1` and `offset`; exposes `rows`, `hasNext`, `isLoading`, `error`, `refetch`. Separate head count on `profiles` for the unfiltered total, shown only when no filter is active. |
| `hooks/useBusinessesDirectory.js` | Same shape via `adminTransport.query('businesses', { count: 'exact', ... })`. Filters: name `ilike`, `business_type` `eq`, claimed/unclaimed on `visible_on_carefind`, location `or` over `state` and `city`. Exposes `rows`, `total` (exact), `hasNext`, `error`. |
| `hooks/useUserActions.js` | `verifyUser({ id, specialty })`, `suspendUser({ id, days })`, `deleteUser({ id, name })`, moved from `LegacyTabHost`. Each resolves `{ ok }` or `{ ok: false, error }`; success audits, records, invalidates, toasts. |
| `ui/DirectoryTable.jsx` | Search box (debounced about 300 ms), filter slot, count line, shared `DataTable`, Previous/Next, and the loading / failed (Retry) / empty (Clear filters) states. Changing search or a filter resets to page 1. |
| `sections/UsersSection.jsx` `BusinessesSection.jsx` | Columns, filters and drawer body per screen on `DirectoryTable` and `ReviewDrawer`. |

Removed from `LegacyTabHost`: the two tabs' render lines and state (`userSearch`,
`userVerifiedFilter`, `userSpecialtyFilter`, `selectedUser`, `suspendDays`, `userPosts`,
`deletingUser`, `verifyingUser`, `verifySpecialty`, `bizSearch`, `bizTypeFilter`,
`bizStateFilter`, `bizStatusFilter`, `selectedBiz`, `bizReviews`, `bizProducts`) and the
handlers `viewUserDetails`, `suspendUser`, `deleteUser`, `reallyDeleteUser`,
`manualVerify`. The old `tabs/UsersTab.jsx`, `tabs/BusinessesTab.jsx` and
`tabs/UsersTab.test.jsx` are deleted once unreferenced. `deletePost` stays (PostsTab).

## Per-screen behaviour

| | Columns | Drawer | Actions |
|---|---|---|---|
| Users | name and @username, title, location, verified badge, joined | details, the 3 most recent posts, Call (phone only when known from a verification request), Website | Verify (non-empty specialty required); Suspend (1/3/7/14/30/365 days, now with confirmation); Delete (confirmation; hidden for the signed-in admin) |
| Businesses | name, type, location, Claimed/Unclaimed, added | details, reviews and products loaded on open (own loading/failed/empty states), review count, product count, average rating | none today, so none added; Export company data CSV |

- "Claimed" means `visible_on_carefind`, as in the legacy tab.
- The title filter becomes **Specialty** and filters the server's `specialty` column.
  Legacy filtered `verification_label` in the browser; the two never matched.
- Export CSV exports the current page and says "this page" in its label. The server has no
  all-rows endpoint to call.
- Suspend gains a confirmation. That is the only behaviour change to an existing action.

## States

Loading: skeleton rows. Failed list: "Couldn't load, Retry", never "No users match".
Empty with filters: "No users match these filters" with Clear filters; empty without
filters: "No users yet" / "No businesses yet". Count line: unfiltered users show the head
count; filtered users show "N shown" (no total is available); businesses show the exact
filtered total. Next is enabled only when the extra `limit + 1` row came back. A failed
posts, reviews or products load shows an inline message in the drawer, never "0". Actions:
the drawer stays open on failure with the error inline, and closes on success.

## Findings to document

29. Users and Businesses loaded the newest 100 rows and filtered in the browser, so
    search could not find older rows; the header showed the loaded count. Fixed.
30. `list_user_profiles` interpolates the search term into `.or(\`full_name.ilike.%${search}%,...\`)`.
    A comma or parenthesis in the term can change the filter. Backend; documented, not changed.
31. `phoneMap` is built only from verification requests, so most users show no Call button.
32. The Users title filter and the server `specialty` filter did not match. Fixed (Specialty).
33. `BusinessesTab` received an unused raw `supabase` client prop. Removed.
34. Suspend had no confirmation. Added.

## Testing

- `or` filter op: terms containing `, ( ) " \ % _` cannot add or change a clause.
- `useUsersDirectory`, `useBusinessesDirectory`: params sent, `limit + 1` and `hasNext`,
  failure surfaces as an error and not `[]`, filtered totals.
- `useUserActions`: payloads, audit and action history, failure path.
- `UsersSection`, `BusinessesSection`: states, debounce and page reset, filter and paging
  calls, independent drawer-data failures, Delete hidden for yourself, Suspend
  confirmation. The old UsersTab "export renders its icon" regression is kept.
- `DirectoryTable`: states, Clear filters, Previous/Next.
- Existing panel tests keep passing; a panel test covers routing and the permission-hidden
  fallback for both tabs. Full suite, build and lint run before the PR.
- Responsive widths (375, 390, 768, 1024, 1440, 1920) cannot be measured without an admin
  session; the PR says so.

## Delivery

One commit per unit; the transport `or` op is its own commit. `docs/ADMIN_REDESIGN.md`
gets findings 29-34 and the phase table update. The PR is a draft stacked on PR #23, with
the responsive check stated as outstanding.
