# CareFind admin Phase 2a: trust queues

Date: 2026-10-12
Builds on: `2026-10-12-carefind-admin-phase1-design.md` (PR #22, branch `feat/carefind-admin-phase1`).
Branch: `feat/carefind-admin-phase2a`, based on the Phase 1 branch.

## Goal

Move Verification, Claims, Reports and Moderation out of `legacy/LegacyTabHost.jsx`
into redesigned sections built from one reusable review queue: a table, status
filters, and a review drawer. Users and Businesses are Phase 2b.

## Scope and constraints

- Same `callAdminAuth` actions, same payloads, same audit and action-history writes.
  No backend, SQL, auth or financial change.
- No UI-only permission checks presented as security. The server decides (Phase 1
  finding 1). Existing hide-by-permission navigation stays.
- A source that fails to load shows as failed, never as an empty list or zero.
- Review actions never change meaning: Approve, Reject, Dismiss and Delete call
  exactly what their labels say.

## Units

| Unit | Responsibility |
|---|---|
| `ui/ReviewDrawer.jsx` | Wraps the shared `Modal variant="drawer"`. Full-screen under 768px, focus returns to the row on close, Esc closes. Title, status badge, body, sticky action footer, inline error. |
| `ui/ReviewQueue.jsx` | Wraps the shared `DataTable`. Status tabs (Pending default, All), count from `lib/attention.js` `openItems`/`oldestTime`, loading skeleton, "Couldn't load, Retry", empty, `N+` when the server cap is hit. Row click opens the drawer; rows are keyboard operable. |
| `hooks/useTrustQueues.js` | Reads verifications, claims and reports through the existing repositories and `['admin', ...]` query keys, so realtime invalidation keeps working. One settled state per source. |
| `hooks/useReviewActions.js` | approve/reject verification, approve/reject claim, resolve report, delete post, open credential. Moved from `LegacyTabHost`, behaviour unchanged. Each writes audit and `recordAction`, then `invalidateAdmin()` and a toast. |
| `sections/VerificationsSection.jsx` `ClaimsSection.jsx` `ReportsSection.jsx` `ModerationSection.jsx` | Columns plus drawer body per queue. |

Removed from `LegacyTabHost`: the four tabs' render lines, `credentialLoadingId`,
`credentialError`, and the handlers above. The old `tabs/VerificationsTab`,
`ClaimsTab`, `ReportsTab` and `ModerationQueue` are deleted once unreferenced.

## Per-screen behaviour

| Screen | Columns | Drawer | Actions |
|---|---|---|---|
| Verification | applicant, profession, workplace, submitted, status | contact, workplace, request, View credential (opens a tab synchronously, then signs the URL; popup-blocked message kept) | Approve; Reject with confirmation |
| Claims | business, submitted, status | business name and claim details as returned | Approve; Reject with confirmation |
| Reports | reason, post excerpt, submitted, status | full post text, reason, time | Delete post (confirmation, as today); Dismiss, which calls `resolve_report` with the report id |
| Moderation | priority, source, summary, age | the same body as the item's own screen | per-item actions; bulk bar |

## Moderation and bulk actions

- Bulk actions dispatch by each item's real type and use the correct id. A report is
  resolved by its report id, not the post id.
- Bulk Reject is removed for reports. Labels say what they do: "Dismiss reports",
  "Reject verifications", "Delete posts".
- Skipped and failed items are named in the result toast, not silently counted.
  Bulk delete keeps its confirmation.
- Selection uses the existing `moderationStore`; row checkboxes are labelled
  `<input type="checkbox">`.
- `lib/priorityScoring.js` is unchanged.

## States

Loading skeleton rows. Failed source: "Couldn't load, Retry". Empty: "Nothing waiting"
under Pending, "No requests yet" under All. Capped: `N+` with a note. Per action: busy
button; on failure the drawer stays open with the error inline; on success it closes
and the list refreshes.

## Findings to document (not hidden by the redesign)

16. Moderation items for reports are keyed by post id, and bulk approve and reject
    send that id to `resolve_report`, which expects a report id. The call most likely
    resolves nothing while being counted as a success, and the audit row carries the
    post id. Fixed in its own commit.
17. Moderation "Reject" on a report calls `resolve_report`, the same as "Approve".
    Labels and behaviour are corrected in the same fix.

## Testing

- `ReviewDrawer`, `ReviewQueue`: states, focus return, Esc, keyboard rows, mobile
  full-screen.
- `useReviewActions`: each action's payload, audit call, failure path; regression
  test that a report is resolved by its report id.
- One test file per section: loading, per-source error, empty, capped, action success
  and failure.
- Existing panel and moderation tests keep passing. Full suite, build and lint run
  before the PR.
- Responsive widths (375, 390, 768, 1024, 1440, 1920) are not measurable without an
  admin session; the PR states so.

## Delivery

One commit per unit. The two Moderation id fixes are separate commits from the
refactor. `docs/ADMIN_REDESIGN.md` gets findings 16 and 17 and an updated phase
table. The PR targets `main` and waits on PR #22.
