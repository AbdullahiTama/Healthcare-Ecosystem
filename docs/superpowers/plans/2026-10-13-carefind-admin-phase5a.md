# CareFind admin Phase 5a (Insight tabs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Audit log, Searches, Alerts, Drug intel and Errors out of `legacy/LegacyTabHost.jsx` into redesigned sections that never present a failed or unchecked source as "nothing here" or "all clear".

**Architecture:** Four settled-read hooks (`useAuditLog`, `useSearchAnalytics`, `useAlerts`, `useDrugReviews`) with pure helpers, one section per tab on the existing shell patterns (`DirectoryTable`, `MetricStrip`, `AdminSection`, `useAdmin`), `AdminPanel` routes the five keys, and the legacy host loses the five tabs.

**Tech Stack:** React, Vite, vitest (jsdom), @tanstack/react-query v5, `packages/design-system`, `callAdminAuth`.

**Spec:** `docs/superpowers/specs/2026-10-13-carefind-admin-phase5a-design.md` (binding). ADM = `apps/carefind/src/modules/admin/`.

## Global Constraints

- No backend, SQL or auth change. Same `callAdminAuth` actions; never a `token` field in a payload.
- No UI-only permission check presented as security; `AdminPanel`'s `isAllowed` gate stays first and unchanged.
- A source that fails shows "Couldn't load … Retry", never an empty list, a zero, or "All clear".
- Audit metadata, search text, review comments are rendered as text only (never HTML, never `dangerouslySetInnerHTML`).
- Keep the legacy withdrawal alert amount calculation exactly (`w.amount * 200`, `toLocaleString()`); do not change financial maths (documented as finding 79).
- Window labels are honest: audit "newest 200 rows" (endpoint cap `limit`), searches "last 300 searches".
- Tests: `createWrapper` is NOT exported by `src/test/renderWithQueryClient.jsx`; use a local `makeWrapper()` with one `QueryClient` per test. The shared Modal card has `role="button"`: use exact role names and `within(dialog)`. Do not return a mock from a `beforeEach` arrow. ESLint has no React plugin: every JSX component must be imported (scan after writing).
- One commit per task; commit and stage in one command with explicit paths; messages end `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Full vitest takes ~15 minutes and is memory heavy; tasks run only their focused tests plus `npx vitest run src/modules/admin`.

## Review Focus

- A failed read in any tab or any single Alerts source must never read as empty / "All clear" (tests: failed -> Retry; one failed source with others empty -> banner, no "All clear").
- Audit log paging when the endpoint has no `offset`: page N requests `min(200, (N+1)*25 + 1)` rows; a page beyond the 200 cap must not show an empty page as "no entries" (test: cap note, Next disabled at the cap).
- Actor filter is client-side over the loaded rows and labelled so; changing a server filter resets to page 1.
- Search/review text with markup (`<img onerror>`) renders inert text; a null `profiles` row shows "Guest".
- Drug intel: two quick searches must not let the older result overwrite the newer (late-result guard).
- Alerts cards link only to tabs the role has (`isAllowed`); a card for a tab the role lacks is shown without a link, not hidden (the operator still learns something is pending).
- The Errors section makes no network call at all.

---

### Task 1: useAuditLog

**Files:**
- Create: `ADM/hooks/useAuditLog.js`, `ADM/hooks/useAuditLog.test.jsx`

**Interfaces:**
- Produces: `AUDIT_PAGE_SIZE = 25`, `AUDIT_MAX_ROWS = 200`, `useAuditLog({ action='all', targetType='all', dateFrom='', dateTo='', page=0 })` returning a react-query result whose `data` is `{ rows, hasNext, capped }`.

- [ ] **Step 1: Failing test.** Mock `../adminApi` `callAdminAuth`. Cases: (a) page 0 with defaults calls `list_audit_logs` once with exactly `{ limit: 26, action: 'all', target_type: 'all', dateFrom: '', dateTo: '' }` (no `token` key) and returns the first 25 rows, `hasNext` true when 26 rows came back; (b) page 2 requests `limit: 76` and returns rows 50-74; (c) page 7 requests `limit: 200` (not 201) and, when 200 rows come back, `hasNext` is false and `capped` is true; (d) fewer rows than the page => `hasNext` false, `capped` false; (e) a response without a `data` array rejects (query `isError`), never `rows: []`; (f) a rejected call is an error; (g) the enriched fields `actor_name`, `target_type`, `metadata` pass through untouched.
- [ ] **Step 2: FAIL. Step 3: implement**

```js
import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

export const AUDIT_PAGE_SIZE = 25
export const AUDIT_MAX_ROWS = 200

// One page of the audit trail, filtered on the server. The endpoint has no
// offset, so page N asks for everything up to the end of page N plus one row
// (to detect a next page), capped at the endpoint's 200 rows. A failed list
// rejects; it is never shown as an empty trail.
async function loadAudit({ action, targetType, dateFrom, dateTo, page }) {
  const wanted = (page + 1) * AUDIT_PAGE_SIZE + 1
  const limit = Math.min(AUDIT_MAX_ROWS, wanted)
  const res = await callAdminAuth('list_audit_logs', {
    limit, action, target_type: targetType, dateFrom, dateTo,
  })
  if (!Array.isArray(res?.data)) throw new Error('list_audit_logs returned no list')
  const start = page * AUDIT_PAGE_SIZE
  return {
    rows: res.data.slice(start, start + AUDIT_PAGE_SIZE),
    hasNext: res.data.length > start + AUDIT_PAGE_SIZE,
    // True when the endpoint's cap, not the data, ended the list.
    capped: res.data.length >= AUDIT_MAX_ROWS,
  }
}

export function useAuditLog({ action = 'all', targetType = 'all', dateFrom = '', dateTo = '', page = 0 } = {}) {
  const params = { action, targetType, dateFrom, dateTo, page }
  return useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => loadAudit(params),
    placeholderData: (prev) => prev,
  })
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): audit log hook with server-side filters and paging`.

---

### Task 2: useSearchAnalytics and the tally helpers

**Files:**
- Create: `ADM/lib/searchTally.js`, `ADM/lib/searchTally.test.js`, `ADM/hooks/useSearchAnalytics.js`, `ADM/hooks/useSearchAnalytics.test.jsx`

**Interfaces:**
- Produces: `tallyTerms(rows, limit = 12)`, `demandGaps(rows, limit = 15)` -> `[[term, count], ...]`; `useSearchAnalytics(enabled = true)` -> react-query result with `data` = the rows array (only rows with a `query`), key `['admin','searches']`.

- [ ] **Step 1: Failing tests.** `searchTally`: terms are lower-cased and trimmed so "Panadol " and "panadol" tally together; sorted by count descending, ties keep first-seen order; the `limit` is honoured; `demandGaps` counts only rows with `found` falsy; rows with no `query` (or a non-string) are ignored, never counted as ""; empty input -> `[]`. Hook: calls `list_search_logs` with exactly `{}` (no `token`); returns only rows that have a string `query`; a response without `data` array rejects; a rejected call is an error (not `[]`).
- [ ] **Step 2: FAIL. Step 3: implement**

```js
// lib/searchTally.js
const keyOf = (row) => (typeof row?.query === 'string' ? row.query.toLowerCase().trim() : '')

function tally(rows, limit) {
  const counts = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }
  // Array.prototype.sort is stable, so ties keep first-seen order.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

export const tallyTerms = (rows, limit = 12) => tally(rows, limit)
export const demandGaps = (rows, limit = 15) => tally(rows.filter(r => !r.found), limit)
```

```js
// hooks/useSearchAnalytics.js
import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

// The newest 300 searches (the endpoint's window). A failed read rejects; it is
// never shown as "no searches yet".
export function useSearchAnalytics(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'searches'],
    queryFn: async () => {
      const res = await callAdminAuth('list_search_logs', {})
      if (!Array.isArray(res?.data)) throw new Error('list_search_logs returned no list')
      return res.data.filter(r => typeof r?.query === 'string' && r.query.trim() !== '')
    },
    enabled,
    staleTime: 60_000,
  })
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): search analytics hook and tally helpers`.

---

### Task 3: useAlerts and buildAlerts

**Files:**
- Create: `ADM/lib/buildAlerts.js`, `ADM/lib/buildAlerts.test.js`, `ADM/hooks/useAlerts.js`, `ADM/hooks/useAlerts.test.jsx`

**Interfaces:**
- Produces: `ALERT_SOURCES` = `[{ key, label, load }]` is internal to the hook; `buildAlerts(sources)` where `sources` is `{ verifications, claims, reports, withdrawals, taskSubmissions, consultations, news }` each `{ status:'ok', data } | { status:'error' }` -> `{ alerts, failed }` (`alerts` sorted newest first; `failed` the human labels of the error sources, in the fixed order below); `useAlerts(enabled = true)` -> react-query result whose `data` is `{ alerts, failed }`, key `['admin','alerts']`.
- Source labels (fixed order): Verifications, Claims, Reports, Withdrawals, Task submissions, Consultations, News.

- [ ] **Step 1: Failing tests.** `buildAlerts` (pure): reproduces the legacy derivation exactly: verification `{ type:'verification', title:'Verification request from <full_name>', subtitle: profession, severity:'warning', tab:'verifications' }`; claim `Business claim: <businesses.name>`, subtitle `Pending approval`, warning, tab `claims`; report `Post reported: <reason>`, subtitle first 60 chars of `posts.content`, severity `urgent`, tab `reports`; withdrawal `Withdrawal request: ₦${(amount * 200).toLocaleString()}`, subtitle `profiles.full_name || 'User'`, warning, tab `withdrawals`; task submission `Task submission: <tasks.title>`, subtitle `profiles.full_name || 'Professional'`, `info`, tab `tasks`; consultation (ALL rows, no status filter) `New consultation booking`, subtitle `profiles.full_name || 'Professional'`, `info`, tab `overview`; news `News submission: <headline first 60 || 'New article'>`, subtitle `profiles.full_name || profiles.display_name || 'Contributor'`, warning, tab `news`. Only `status === 'pending'` rows count for all but consultations. An error source contributes no alerts and appears in `failed`; with every source ok and nothing pending, `{ alerts: [], failed: [] }`; with one source failed and the rest empty, `alerts` is empty and `failed` is `['Withdrawals']` (so the screen can refuse "All clear"). Sort is newest `time` first. A row with a null nested object (`businesses: null`) does not throw. Hook: each of the 7 sources is read independently (one rejecting call does not fail the others; its label lands in `failed`); the actions are `list_verification_requests`, `list_business_claims`, `list_reports`, `list_withdrawal_requests`, `list_task_submissions`, `list_news` via `callAdminAuth(action, {})` reading `.data`, and `dashboardRepository.getProfessionalConsultations()`; no payload carries `token`; a non-array result counts as that source failing.
- [ ] **Step 2: FAIL. Step 3: implement.** Port the legacy mapping from `apps/carefind/src/hooks/queries.js` (the `notifications` block in `useAdminData`, lines ~925-934) verbatim into `buildAlerts`, adding only the `failed` bookkeeping and null-safe optional chaining; the hook settles each source (`try { Array.isArray(r) ... } catch { error }`). Do NOT modify `useAdminData` or its `notifications` block (Teams/Tasks/Shop still use it until 5b/5c).
- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): alerts built from independently settled sources`.

---

### Task 4: useDrugReviews

**Files:**
- Create: `ADM/hooks/useDrugReviews.js`, `ADM/hooks/useDrugReviews.test.jsx`

**Interfaces:**
- Produces: `useDrugReviews()` -> `{ result, searching, search(term) }` where `result` is `null` (nothing searched yet), `{ status:'ok', term, product, matches, reviews }` (`product` is the first match or `null` when none; `matches` the match count; `reviews` an array), or `{ status:'error', term }`; `search(term)` resolves nothing and ignores an empty/blank term. A late result from an older search never overwrites a newer one.
- Consumes: `commerceRepository.searchProducts(term)`, `commerceRepository.getProductReviews(ids)` (the same repository the legacy `searchDrugs` used).

- [ ] **Step 1: Failing test.** Mock `../repositories/commerceRepository`. Cases: blank/whitespace term makes no call and leaves `result` null; a match loads reviews for ALL matched product ids exactly as legacy did (`getProductReviews(products.map(p => p.id))`) and returns `product` = first match, `matches` = N; no match -> `{ status:'ok', product:null, matches:0, reviews:[] }` and no reviews call; `searchProducts` rejecting -> `{ status:'error', term }`; `getProductReviews` rejecting -> error (never empty reviews); `searching` true while running; two searches where the first resolves AFTER the second leave the second's result in place (late-result guard with a deferred promise); an unmounted hook does not set state (no act warning).
- [ ] **Step 2: FAIL. Step 3: implement** with plain `useState` plus a monotonically increasing request-id ref (`const latest = useRef(0)`; each `search` takes `++latest.current`; a result applies only if its id is still current and the component is mounted via a `mounted` ref).
- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): drug reviews hook with a late-result guard`.

---

### Task 5: AuditLogSection

**Files:**
- Create: `ADM/sections/AuditLogSection.jsx`, `ADM/sections/AuditLogSection.test.jsx`

**Interfaces:**
- Consumes: `useAuditLog` (Task 1, mocked in tests), `DirectoryTable` (props as used by `PostsSection`: `title, noun, plural, query, columns, search, onSearch, searchPlaceholder, filters, filtersActive, onClear, page, onPage, renderDrawer, toolbar, rowLabel`), `FilterPills`, `DateRange`, `exportCSV`, `timeAgo` from `../ui`.
- Note: `DirectoryTable`'s search box is the **actor name filter** (client-side over the loaded rows, placeholder `Filter loaded rows by actor…`). Because `DirectoryTable` reads `query.data.rows`, pass a derived query object `{ ...query, data: query.data && { ...query.data, rows: filteredRows } }` (memoised) so the actor filter narrows what the table shows without another request. The `total` is not shown.

- [ ] **Step 1: Failing test** (mock `../hooks/useAuditLog`; use `makeWrapper` only if a query is real). Cases, written in full: loading state; failed list -> "Couldn't load" + Retry calling `refetch`, never "No audit log entries"; empty successful list -> "No audit log entries"; rows show actor (`actor_name || 'Unknown'`), action with underscores replaced by spaces, target type, relative time; the coloured dot class per action as legacy (delete/suspend/bulk_delete danger; approve/bulk_approve success; reject/bulk_reject warning; else info), implemented as CSS classes on `ui/admin.css` not inline hex; opening a row shows a drawer with the full metadata as text (object -> `JSON.stringify(value, null, 2)` inside a `<pre>`; string -> as is; none -> "No details recorded"); markup in metadata renders as inert text (query for the literal string, `img` count 0); changing the action filter calls `useAuditLog` with `action` set and resets `page` to 0; the date inputs pass `dateFrom`/`dateTo`; the actor filter narrows loaded rows without changing the hook params and the screen says "Filters the rows loaded"; when `capped` the note "Showing the newest 200 entries" is visible and Next is disabled on the last capped page; Export CSV exports the CURRENT (actor-filtered) page rows with the file name `audit_log_page.csv`, disabled when no rows.
- [ ] **Step 2: FAIL. Step 3: implement.** Action options and target-type options are the legacy lists (`ACTION_OPTIONS`, `TARGET_TYPES`) as `FilterPills` option arrays (note in a comment: the known verbs the admin hooks record; a verb not listed is still visible under "All"). Column set: time, actor, action, target, details excerpt (first 60 chars, ellipsis). Drawer title `<action> · <target>`.
- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): audit log screen with server filters and a detail drawer`.

---

### Task 6: SearchesSection

**Files:**
- Create: `ADM/sections/SearchesSection.jsx`, `ADM/sections/SearchesSection.test.jsx`

**Interfaces:**
- Consumes: `useSearchAnalytics`, `tallyTerms`, `demandGaps`, `MetricStrip` (`items: [{ key, label, value, hint, status, onRetry }]`), `AdminPageHeader`, `AdminSection`, `Empty`.

- [ ] **Step 1: Failing test** (mock the hook). Cases: loading -> `MetricStrip` cells in `loading` status and section placeholders; failed -> the strip cells `error` + Retry and each section shows "Couldn't load" + Retry (calls `refetch`), never "No searches yet"/"No unmet searches yet"; success -> strip shows "Searches" = rows with text and "Found nothing" = rows with `!found`, hint "last 300 searches"; Demand gaps lists `term` + `N× wanted` (up to 15, most wanted first); Top terms lists rank, term, count (up to 12); Recent searches shows at most 40 rows with query, category, user (`profiles.full_name || profiles.display_name || 'Guest'`), and a found/none badge (`${results_count} found` / `none`); a `profiles: null` row shows "Guest"; query text with markup renders inert; empty successful list -> the three legacy empty messages ("No unmet searches yet", "No searches yet", "No recent searches"); the page subtitle states "Based on the newest 300 searches".
- [ ] **Step 2: FAIL. Step 3: implement** with `adm-*` classes (reuse existing list classes; add a small `adm-rank` class in `ui/admin.css` for the rank chip rather than inline styles); keys are `row.id` or `term`.
- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): search analytics screen with honest windows`.

---

### Task 7: AlertsSection

**Files:**
- Create: `ADM/sections/AlertsSection.jsx`, `ADM/sections/AlertsSection.test.jsx`

**Interfaces:**
- Consumes: `useAlerts` (data `{ alerts, failed }`), `useAdmin().permissions`, `isAllowed(permissions, key)` from `../navigation`, a prop `onOpenTab(tabKey)` (pass `setTab` from `AdminPanel`, as `OverviewSection` receives).

- [ ] **Step 1: Failing test** (mock `useAlerts` and `useAdmin`). Cases: loading placeholder; the whole query failed -> "Couldn't check alerts" + Retry, never "All clear"; success with failed sources and no alerts -> a `role="alert"` banner "Couldn't check: Withdrawals, News" with Retry, and the text "All clear" absent (and an explicit "Nothing pending in the sources that loaded"); success with nothing pending and nothing failed -> "All clear — nothing pending"; alerts render grouped under headings Urgent, Warning, Info (only groups with items), each card with icon-by-type (legacy `ICON_MAP`), title, subtitle, relative time, severity badge; a card for a tab the role may open is a button that calls `onOpenTab(tab)`; a card for a tab the role may not open (`permissions` switches it off) renders without a button/link and with the hint "Not available to your role"; the banner and cards both appear when some sources failed and others have alerts; text with markup renders inert.
- [ ] **Step 2: FAIL. Step 3: implement.** Severity styling via classes in `ui/admin.css` (`adm-sev-urgent|warning|info`) using existing colour tokens, not inline hex.
- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): alerts screen that says what it could not check`.

---

### Task 8: DrugIntelSection

**Files:**
- Create: `ADM/sections/DrugIntelSection.jsx`, `ADM/sections/DrugIntelSection.test.jsx`

**Interfaces:**
- Consumes: `useDrugReviews` (Task 4), `Input`, `Button`, `StatCard`/`MetricStrip`, `FilterPills`, `DateRange`, `exportCSV`, `timeAgo`, `Empty`.

- [ ] **Step 1: Failing test** (mock the hook). Cases: before any search -> the legacy prompt "Search for a medication to view user reviews and sentiment analysis"; Enter in the box and the Search button both call `search(term)`; the button is disabled while `searching` and when the box is blank; failed -> "Couldn't search" + Retry that repeats the same term; no match -> "No medication matches"; matched with no reviews -> "No reviews yet"; matched -> heading "Reviews for <name>", and when `matches > 1` the line "Showing the first of N matches"; rating pills (All, 1-5 Stars) and the date range filter the loaded reviews client-side (`created_at >= from`, `<= to + 'T23:59:59'`); average rating and counts (positive 4-5, neutral = rest, negative 1-2) computed from the FILTERED reviews with the legacy formula; a filter that removes every review says "No reviews match these filters" with Clear filters, never "No reviews yet"; Export CSV exports the filtered reviews as `<name>_filtered_reviews.csv`; review comment markup renders inert; star display keeps the legacy 5-star row.
- [ ] **Step 2: FAIL. Step 3: implement** with `adm-*` layout classes (grid collapses to one column on narrow widths; no fixed widths).
- [ ] **Step 4: PASS. Step 5: Commit** `feat(carefind): drug intelligence screen that names the product it searched`.

---

### Task 9: ErrorsSection, wiring, and retiring the legacy code

**Files:**
- Create: `ADM/sections/ErrorsSection.jsx`, `ADM/sections/ErrorsSection.test.jsx`
- Modify: `ADM/AdminPanel.jsx`, `ADM/AdminPanel.sections.test.jsx`, `ADM/legacy/LegacyTabHost.jsx`
- Delete: `ADM/tabs/DrugsTab.jsx`, `ADM/tabs/SearchesTab.jsx`, `ADM/tabs/NotificationsTab.jsx`, `ADM/tabs/ErrorsTab.jsx`, `ADM/components/AuditLog.jsx` (and any test files for them)

- [ ] **Step 1: ErrorsSection test + implementation.** Renders the heading "Error Inbox" and "The error inbox isn't connected yet" with the explanation "The server has no actions to list or resolve errors, so there is nothing to show here." It imports neither `callAdminAuth` nor any query hook; the test spies on `../adminApi` and `fetch` and asserts neither is called. Commit `feat(carefind): honest unavailable state for the error inbox`.
- [ ] **Step 2: AdminPanel.** Import the five sections; in `ActiveSection`, AFTER the `isAllowed` check (which stays first and unchanged), route `notifications` -> `<AlertsSection onOpenTab={setTab} />`, `audit_log`, `searches`, `drugs`, `errors`. Mirror the Phase 4b wiring commit (`git show 7e8d30b --stat`).
- [ ] **Step 3: LegacyTabHost.** Delete ONLY dead code: the five tab imports and render lines; the drug state (`drugSearch, drugReviews, drugName, drugRatingFilter, drugDateFrom, drugDateTo`) and `searchDrugs`; `useAdminSearchLogs` and `searchLogs`; `notifications`/`notifCount`/`roleNotifCount`/`stats` from the `adminData` destructure ONLY if grep confirms nothing remaining uses them; the `commerceRepository` import only if nothing else uses it (Shop's `updateEcomApp`/`moderateProduct` use `callAdminAuth`, not it). Grep every removed identifier and every import before removing; a ReferenceError in `LegacyTabHost` would crash every remaining legacy tab (Tasks, Teams, Shop, Email templates).
- [ ] **Step 4: Delete the five files**, then `grep -rn "DrugsTab\|SearchesTab\|NotificationsTab\|ErrorsTab\|components/AuditLog" apps/carefind/src` and fix importers (report what changed). `hooks/queries.js` is not modified (`useAdminSearchLogs` becomes dead; documented).
- [ ] **Step 5: Extend `AdminPanel.sections.test.jsx`** `TABS` with the five keys (nav labels `Alerts`, `Audit log`, `Searches`, `Drug intel`, `Errors`; headings per section) so the generic loops cover routing and the not-permitted fallback.
- [ ] **Step 6: Verify** `npx vitest run src/modules/admin`, `npm run build`, `npm run lint`; scan touched files for un-imported JSX components. Commit `refactor(carefind): the insight tabs leave the legacy host`.

---

### Task 10: Docs

**Files:**
- Modify: `docs/ADMIN_REDESIGN.md` (docs only; no push, no PR, no full suite)

- [ ] **Step 1:** Phase table: 4b "built (PR #27)", 5a "built on `feat/carefind-admin-phase5a` (Alerts, Audit log, Searches, Drug intel, Errors)", 5b, 5c remain. Code organisation: the four hooks, `lib/buildAlerts`, `lib/searchTally`, five sections; `useAdminSearchLogs` dead until 5c; `useAdminData`'s notifications block stays (Teams/Tasks/Shop) until 5b/5c.
- [ ] **Step 2: Findings 73-78** as in the spec (verify each fact with Read/Grep first; real SHAs from `git log --oneline feat/carefind-admin-phase4b..HEAD`) plus **79**: the withdrawal alert converts `amount * 200` to naira with a hard-coded rate in the client (kept as legacy; the wallet rate lives elsewhere). Verify with Grep before writing it.
- [ ] **Step 3: Verification state** (unit/component tests listed; responsive layout NOT measured; behaviour against production data NOT exercised).
- [ ] **Step 4: Commit** `docs(carefind): Phase 5a state and findings 73-79`.

---

## Self-review

- **Spec coverage:** audit hook with server filters and paging (T1); search analytics + honest windows (T2); alerts per-source honesty with legacy derivation (T3); drug first-match + failures (T4); the five screens (T5-T9); routing/legacy retirement (T9); findings 73-79 (T10). Spec point "alert cards link only to tabs the role can open" is T7; "Errors makes no calls" is T9 step 1.
- **Plan decisions the spec left open:** audit paging with no endpoint offset (grow `limit`, cap at 200, `capped` flag); actor filter via a derived query object; cards for tabs a role lacks stay visible without a link; finding 79 added.
- **Known thin spots:** section tests of T5-T8 are exact case lists, not code (earlier phases needed fix rounds on exactly these); `buildAlerts` is ported by instruction from `queries.js` rather than pasted, so the implementer must read it; the audit action option list is the legacy one and may not cover every recorded verb.
- **Type consistency:** `useAuditLog` data `{ rows, hasNext, capped }` used by T5; `useAlerts` data `{ alerts, failed }` used by T7; `useDrugReviews` `{ result, searching, search }` used by T8; `tallyTerms`/`demandGaps` return `[[term, count]]` used by T6.
