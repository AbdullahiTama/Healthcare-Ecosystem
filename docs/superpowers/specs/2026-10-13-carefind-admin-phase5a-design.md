# CareFind admin Phase 5a: Insight (Audit log, Searches, Alerts, Drug intel, Errors)

Date: 2026-10-13
Builds on: Phase 4b (`2026-10-12-carefind-admin-phase4b-design.md`, PR #27).
Branch: `feat/carefind-admin-phase5a`, based on the Phase 4b branch.
Phase 5 is split: 5a (this spec) the read-mostly insight tabs; 5b Teams, staff and roles, Tasks; 5c Shop,
Email templates, then deleting `legacy/` and the dead hooks.

## Goal

Move five tabs out of `legacy/LegacyTabHost.jsx` into redesigned screens, and make each one stop telling the
operator something false: a failed load that reads as "nothing here", "All clear" while a source could not be
checked, and an Errors tab that has never worked.

## Scope and constraints

- No backend, SQL or auth change. Same `callAdminAuth` actions and payloads: `list_audit_logs { limit, action,
  target_type, dateFrom, dateTo }`, `list_search_logs {}`. Never a `token` field (the legacy tabs read a dead
  `admin_token`; it is not carried over). Reads for Alerts keep their existing actions.
- Drug intel keeps `commerceRepository.searchProducts` and `getProductReviews`.
- No UI-only permission check presented as security; `AdminPanel`'s `isAllowed` gate covers every tab. Alert
  cards link only to tabs the role can open; the server still decides access (Phase 1 finding 1).
- A source that fails to load shows "Couldn't load, Retry", never an empty list, a zero or "All clear".
- Audit metadata and search text are shown as text only, never as HTML.
- Numbers are not invented. Labels state the window they cover (newest 200 audit rows, newest 300 searches).

## Units

| Unit | Responsibility |
|---|---|
| `hooks/useAuditLog.js` | Key `['admin','audit', params]`; `list_audit_logs` with server-side `action`, `target_type`, `dateFrom`, `dateTo`; `limit = 25 + 1` and `offset` is not supported by the endpoint, so the hook requests `limit = pageSize * page + 1` and slices the page (the same cost shape as the Phase 2b directory when offset is absent; the page size is capped at the endpoint's 200 rows, documented). Actor name filter is client-side over the fetched rows and labelled as such. Failure is an error. |
| `hooks/useSearchAnalytics.js` | Key `['admin','searches']`; `list_search_logs`; failure is an error. Pure helpers `tallyTerms(rows)` and `demandGaps(rows)` keep today's calculations (lower-cased trimmed query, descending count, top 12 / top 15). |
| `hooks/useAlerts.js` | Key `['admin','alerts']`; reads each source with `callAdminAuth` (`list_verification_requests`, `list_business_claims`, `list_reports`, `list_withdrawal_requests`, `list_task_submissions`, `list_news`) and `dashboardRepository.getProfessionalConsultations`, each settled to `{ status:'ok', data }` or `{ status:'error' }`. A pure `buildAlerts(sources)` keeps the legacy derivation (same titles, severities, tab keys, role keys) from the ok sources and returns `failed: [names]`. |
| `hooks/useDrugReviews.js` | A mutation-like `search(term)` (explicit, not on every keystroke): `searchProducts(term)` then `getProductReviews(ids)` for the first match; settles to `{ product, reviews }`, `{ product: null }` (no match) or an error. |
| `sections/AuditLogSection.jsx` | Filters, table, detail drawer, CSV of the current page. |
| `sections/SearchesSection.jsx` | Metric strip, Demand gaps, Top terms, Recent searches. |
| `sections/AlertsSection.jsx` | Per-source banner, severity-grouped alert cards. |
| `sections/DrugIntelSection.jsx` | Search, filters, sentiment, review list, CSV. |
| `sections/ErrorsSection.jsx` | The unavailable state. |

Removed from `LegacyTabHost`: the render lines for `audit_log`, `errors`, `drugs`, `searches`, `notifications`;
the drug state (`drugSearch, drugReviews, drugName, drugRatingFilter, drugDateFrom, drugDateTo`), `searchDrugs`,
`useAdminSearchLogs`, the `notifications` destructure and the `commerceRepository` import if nothing else uses
them (grep first). `tabs/DrugsTab.jsx`, `SearchesTab.jsx`, `NotificationsTab.jsx`, `ErrorsTab.jsx` and
`components/AuditLog.jsx` are deleted. `useAdminSearchLogs` in `hooks/queries.js` becomes dead; `useAdminData`
stays (Teams/Tasks/Shop still read it) and its notifications block is left in place until 5b/5c, documented.

## Behaviour

| Area | Behaviour |
|---|---|
| Audit log | Filters: action, target type (server-side), date range (server-side), actor name (client-side, labelled "filters the rows loaded"). Table: time, actor, action (coloured dot as legacy), target, details. Drawer shows the full metadata, pretty-printed as text. Paging in 25s. "Showing newest N of up to 200" is stated when the cap is reached. A failed load: "Couldn't load the audit log" + Retry. Export CSV for the current page. |
| Searches | Metric strip: searches with text, found nothing (labelled "last 300"). Demand gaps, Top terms (top 12) and Recent searches (40) as today. Failed load: Retry, never "No searches yet". Guest searches (no profile) keep the "Guest" label. |
| Alerts | Same alert derivation. Cards grouped by severity (urgent, warning, info), each linking to its tab only when the role has it. If any source failed, a banner "Couldn't check: <names>" with Retry sits above the list, and "All clear" is never shown; with no failures and nothing pending it says "All clear — nothing pending". Empty because of failure is never worded as empty. |
| Drug intel | Search runs on the button or Enter, not per keystroke. The matched product is named ("Reviews for <name>") and, when more than one product matched, the screen says "Showing the first of N matches". No match: "No medication matches". No reviews: "No reviews yet". Rating pills and date range filter the loaded reviews; sentiment strip (positive 4-5, neutral 3, negative 1-2), average, Export CSV, as legacy. Failure: Retry. |
| Errors | "The error inbox isn't connected yet" with the reason (no server action exists), no calls, no counts. |

## States

Loading placeholders; failed reads -> Retry; empty states are explicit and only reachable after a successful read;
the actor filter and rating/date filters never turn a failed read into an empty result.

## Findings to document (numbering continues from 72)

73. The Errors tab calls `list_errors` and `resolve_error`, which exist nowhere: not in `admin-auth.js`, not in any
    migration, no error-log table. It has only ever shown a load error. Replaced by an honest unavailable state;
    building the backend is a separate, approved piece of work.
74. The audit log, searches and alerts turned a failed read into an empty list ("No audit log entries", "No
    searches yet") and the Alerts screen could say "All clear" while a source could not be checked. Fixed.
75. The audit log loaded the newest 200 rows and filtered all of them in the browser although the endpoint filters
    on the server; the search analytics tally only the newest 300 searches while labelled as overall. Fixed
    (server filters; windows stated).
76. `list_audit_logs` and `list_search_logs` check only that the token is valid, not the admin's role, so any signed-in
    admin can read the audit trail and all search text (Phase 1 finding 1). Documented, not changed.
77. Drug intel silently used the first matching product and never handled a failed lookup. The match is now named and
    failures are shown.
78. The legacy audit and error tabs sent `localStorage.admin_token` in the payload (a dead field). Dropped.

## Testing

- `useAuditLog`: params sent (filters, limit), page slicing, cap note, failure is an error.
- `useSearchAnalytics` + helpers: tallies, gaps ordering and limits, failure is an error.
- `useAlerts`: each source settles on its own; `failed` lists the failing ones; `buildAlerts` reproduces the legacy
  titles/severities/tab keys; "all clear" only when no failure and nothing pending.
- `useDrugReviews`: first-match behaviour with the match count, no match, failure.
- Sections: states (failed -> Retry, never empty text), filters, drawer, CSV, per-source banner, permission-gated
  links, Errors unavailable (no network calls), routing test extended for the five tabs; permission-hidden fallback.
- Full suite, build and lint before the PR. Responsive widths cannot be measured without an admin session; the PR
  says so.

## Delivery

One commit per unit. `docs/ADMIN_REDESIGN.md` gets findings 73-78, the phase table update (5 split into 5a/5b/5c)
and the dead-code notes. The PR is a draft stacked on PR #27 with the responsive check stated as outstanding.
