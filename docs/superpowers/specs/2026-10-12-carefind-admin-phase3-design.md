# CareFind admin Phase 3: Finance

Date: 2026-10-12
Builds on: Phase 2b (`2026-10-12-carefind-admin-phase2b-design.md`, PR #24).
Branch: `feat/carefind-admin-phase3`, based on the Phase 2b branch.

## Goal

Move Revenue, Orders, Withdrawals and Money checks out of `legacy/LegacyTabHost.jsx` into
redesigned screens that present the same figures **honestly**. Several current figures
come from a capped source or disagree on units; the owner's decision is to keep every
calculation and source exactly as is and label what each figure covers.

## Scope and constraints

- **No financial calculation, formula, unit conversion or data source changes.** No backend,
  SQL or auth change. `reject_withdrawal`, `admin_list_reconciliation`,
  `admin_update_reconciliation_finding`, `admin_run_reconciliation` keep their exact payloads.
- No UI-only permission check presented as security. The server decides (Phase 1 finding 1:
  most admin handlers, including `list_transactions` and `list_withdrawal_requests`, accept
  any valid admin token). `AdminPanel`'s `isAllowed` gate covers all four tabs.
- Do not expose more financial information than the legacy screens: no new fields from
  `select('*')`. Account numbers are masked in tables.
- A source that fails to load shows "Couldn't load, Retry", never an empty list, "no
  transactions", or ₦0.
- The Money checks screen never acts on money; it records decisions about findings only.

## Facts the design rests on (read from the code)

- `list_transactions` returns the latest 50 rows of `transactions`, all types and statuses.
- `RevenueTab` computes "Total Revenue" as `sum(naira_amount of rows where type === 'topup') / 100`
  over those rows only, ignoring `status`; "Top-ups" and "Withdrawals" are counts of rows of
  that type among the same 50.
- `OrdersTab` lists those same 50 transactions (not orders), searches and filters only them,
  and shows `naira_amount` as ₦ without dividing by 100 (Revenue divides by 100).
- `list_withdrawal_requests` is uncapped. `WithdrawalsTab` shows `amount * 200` as ₦ and the
  full bank account number; a request is in flight while `status` is `reserved` or `processing`.
- `reject_withdrawal` asks Paystack first (`decideAdminReject`): it refunds when Paystack says the
  transfer failed (or the legacy row has no reference); when Paystack says it **paid**, the
  request is recorded as paid and the call returns HTTP 409 with a message; when the transfer is
  still in flight or unknown it is blocked with HTTP 409 and a message.

## Units

| Unit | Responsibility |
|---|---|
| `hooks/useFinanceData.js` | react-query key `['admin','finance']`. Loads `list_transactions` and `list_withdrawal_requests`, each settled on its own to `{ status:'ok', data }` or `{ status:'error' }` (a response without a list is an error). Exports `TRANSACTION_CAP = 50`. |
| `hooks/useReconciliation.js` | `useReconciliationFindings(status)` (key `['admin','reconciliation', status]`; `status` `open` sends `{}`, others `{ status }`; failure is an error, not `[]`); `runReconciliation()` and `updateFinding({ id, op, note })` returning `{ ok }` / `{ ok:false, error }`. |
| `hooks/useWithdrawalActions.js` | `rejectWithdrawal(id)` -> `{ ok }` / `{ ok:false, error }`. Writes the same audit and action history the legacy inline handler wrote (read it in `LegacyTabHost` before moving it). On a server error it still invalidates, because a 409 "confirmed paid" has changed the request. |
| `lib/financeFormat.js` | Pure display helpers using the legacy maths verbatim: `topupTotal(transactions)` (`sum(naira_amount of topup)/100`), `countByType`, `nairaFromCoins(amount)` (`amount * 200`), `maskAccount(number)` (last 4 digits). Each has a test pinning the legacy result. |
| `sections/RevenueSection.jsx` | Metrics on `MetricStrip`, transactions on `DataTable` with a status column. |
| `sections/OrdersSection.jsx` | Transactions table with search and status filter (client-side over the loaded 50, paged 15), refresh. |
| `sections/WithdrawalsSection.jsx` | `ReviewQueue` (In progress / All) with a drawer and the reject action. |
| `sections/MoneyChecksSection.jsx` | Findings by status (server-filtered tabs), critical banner, Run checks now, finding drawer with Acknowledge / Dismiss (note) / Reopen. |

Removed from `LegacyTabHost`: the four render lines and the inline `onReject` handler. The
old `tabs/RevenueTab.jsx`, `OrdersTab.jsx`, `WithdrawalsTab.jsx`, `ReconciliationTab.jsx` and
`ReconciliationTab.test.jsx` are deleted once unreferenced; `components/StatusDot.jsx` and
`components/RowActions.jsx` only if a grep shows no other user. `transactions` and
`withdrawals` stay in `useAdminData` (the Overview and notifications read them).

## Per-screen behaviour

| Screen | Content | Honest labelling |
|---|---|---|
| Revenue | Cards: top-up total, top-up count, withdrawal-request count; transactions table (type, description, amount, ₦, status, time) | "Top-ups in the latest 50 transactions (any status)" and similar; the table heading says "Latest 50 transactions". Legacy maths unchanged. |
| Orders | Same 50 rows; search over description and user id; status filter (completed, pending, failed); 15 per page | Subtitle "Wallet transactions, latest 50"; search and filter say they cover these 50; footnote "Amount as stored (naira_amount)". Not moved between nav groups. |
| Withdrawals | In progress (`reserved`/`processing`) and All; columns: person, amount, bank, status, time | Amount shows "N coins · about ₦X at 200 per coin". Table account number is masked to the last 4 digits; the drawer shows the full number and name. |
| Money checks | Status tabs Open / Acknowledged / Resolved / Dismissed; run-now summary | Unchanged wording of the decisions. A dismissal needs a note of at least 5 characters, kept on record. |

- **Withdrawal reject**: "Reject and refund" asks for confirmation. The confirmation states what
  the server does: it checks Paystack first; if the transfer failed the coins are refunded; if
  Paystack says it paid, it is recorded as paid and nothing is refunded; if it is still in
  flight it is blocked. The server's message (409) is shown inline in the drawer, and the list
  refreshes either way.
- Orders stays under Marketplace in navigation; changing groups would change what each role's
  nav switch means. Logged as a finding.

## States

Loading: skeleton rows or placeholders. Failed source: "Couldn't load, Retry" per source; a
failed `list_transactions` must not make Revenue show ₦0 or "No transactions yet".
Empty: "No transactions in the latest 50", "No withdrawal requests yet", "Nothing needs
attention. Every check agrees." (Money checks, as today). Money-check actions: the drawer stays
open on failure with the error inline, closes on success; a busy state per finding.

## Testing

- `financeFormat`: each helper pinned to the legacy result (top-up total ignoring non-topups and
  dividing by 100; any status counted; `amount * 200`; masking).
- `useFinanceData`: each source settles on its own; failed source is an error not `[]`.
- `useReconciliation`, `useWithdrawalActions`: payloads, audit/history, failure and the
  invalidate-on-error behaviour.
- Sections: loading, per-source failure (Revenue never shows ₦0 on failure), empty, labelling text,
  masking, confirmation-gated reject with inline 409 message, critical banner, dismiss note
  minimum, permission-hidden fallback. The behaviours in `ReconciliationTab.test.jsx` are ported
  and kept (it must never call anything but list / update / run).
- Panel routing test extended for the four tabs. Full suite, build and lint before the PR.
- Responsive widths (375, 390, 768, 1024, 1440, 1920) cannot be measured without an admin
  session; the PR says so.

## Findings to document

45. The Revenue "Total Revenue", "Top-ups" and "Withdrawals" cards are computed from only the
    latest 50 transactions (server cap) and ignore status; they are not totals. Labelled, not
    changed.
46. Revenue divides `naira_amount` by 100; Orders shows it undivided. One is wrong by 100x.
    Unit disagreement left as is and labelled; needs the backend owner.
47. "Orders" lists wallet transactions, not shop orders, and lives under Marketplace.
48. Withdrawals converts coins to naira with a hard-coded 200 per coin in the UI.
49. `list_transactions` and `list_withdrawal_requests` are readable by any valid admin token
    (Phase 1 finding 1 applies to money data); hiding the tabs is cosmetic.
50. The legacy withdrawal reject toasted any server error and did not refresh, although a 409
    "confirmed paid" had already changed the request. The new action refreshes.
51. Account numbers were shown in full in the list; now masked in the table.

## Delivery

One commit per unit. `docs/ADMIN_REDESIGN.md` gets findings 45-51 and the phase table update.
The PR is a draft stacked on PR #24 with the responsive check stated as outstanding.
