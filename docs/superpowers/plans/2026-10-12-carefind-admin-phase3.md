# CareFind admin Phase 3 (Finance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Revenue, Orders, Withdrawals and Money checks out of `LegacyTabHost` into redesigned screens that show the same figures honestly labelled, with no change to any financial calculation, source, unit or server call.

**Architecture:** `useFinanceData` loads the two money lists with one settled state per source. `lib/financeFormat.js` holds the legacy maths verbatim as pure, tested helpers. Hooks for reconciliation and withdrawal rejection hold the moved handlers. Four sections are built on the shipped `MetricStrip`, `ReviewQueue`, `ReviewDrawer` and the shared `DataTable`.

**Tech Stack:** React, @tanstack/react-query v5, vitest + Testing Library (jsdom), `@care-ecosystem/design-system/components/ui`.

**Spec:** `docs/superpowers/specs/2026-10-12-carefind-admin-phase3-design.md`

## Global Constraints

- All paths are relative to the worktree root. `ADM` = `apps/carefind/src/modules/admin/`. Run tests from `apps/carefind`: `npx vitest run <path>`. Branch `feat/carefind-admin-phase3` (based on `feat/carefind-admin-phase2b`).
- One commit per task unless the task says otherwise, staged and committed in one command with explicit paths: `git add <paths> && git commit -m "..." -- <paths>`. Messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **No financial calculation, formula, unit conversion or data source changes.** Every number shown must be computed exactly as the legacy tab computed it. No backend/SQL/auth change (nothing under `apps/carefind/api`); `packages/design-system` is not modified. Never send a `token` field.
- Payloads unchanged: `reject_withdrawal { id }`, `admin_list_reconciliation {}` or `{ status }`, `admin_update_reconciliation_finding { id, op, note }`, `admin_run_reconciliation` (no payload).
- No UI-only permission check presented as security. `AdminPanel`'s `isAllowed` gate must still cover all four tabs.
- A source that fails to load shows "Couldn't load" with Retry; it never renders as an empty list, "No transactions", or ₦0.
- Do not show more money data than the legacy screens: no new fields from the `select('*')` rows. Account numbers are masked in tables.
- The shared `Modal` card carries `role="button"` (known defect, Phase 2a finding 21): tests use exact role names and `within(screen.getByRole('dialog'))` where text appears in both the table and the drawer.
- Test plumbing lessons from earlier phases: `createWrapper` is NOT exported by `src/test/renderWithQueryClient.jsx` (use a local `QueryClientProvider` with `new QueryClient({ defaultOptions: { queries: { retry: false } } })` created per render); do not return a mock from a `beforeEach` arrow (use braces); use fake timers only where a debounce/timer is exercised and restore real timers; section tests mock `../provider/AdminProvider.jsx` with `useAdmin: () => ({ askConfirm, showToast, invalidateAdmin, confirming: false, ... })`.
- ESLint has no React plugin: after writing JSX, check every component used is imported. Run `npm run lint` from `apps/carefind` (0 errors).
- The full vitest suite takes 10+ minutes: during tasks run only `npx vitest run src/modules/admin`.

## Review Focus

- Revenue/Orders figures equal the legacy computation for the same input; a failed `list_transactions` never shows ₦0 or "No transactions" (Tasks 1, 2, 5, 6).
- The withdrawal reject sends only `{ id }`, asks confirmation, shows the server's 409 message inline, and refreshes the list on a server error (Tasks 4, 7).
- Account numbers are masked in tables and shown only in the drawer (Task 7).
- Money checks never calls anything but the three reconciliation actions; a dismissal needs a note of at least 5 trimmed characters (Tasks 3, 8).
- Permission-hidden fallback and routing for all four tabs; nothing dangling in `LegacyTabHost` (Task 9).

---

### Task 1: financeFormat (the legacy maths, pinned)

**Files:**
- Create: `ADM/lib/financeFormat.js`, `ADM/lib/financeFormat.test.js`

**Interfaces:**
- Produces: `topupTotal(transactions)` = `sum(naira_amount where type === 'topup', null as 0) / 100` (status NOT considered, exactly as `RevenueTab` did); `countByType(transactions, type)`; `nairaFromCoins(amount)` = `amount * 200` (as `WithdrawalsTab` did); `maskAccount(number)` returns `••••` + last 4 digits for a string of at least 4 characters, else `'—'`; `isInFlight(withdrawal)` = status `reserved` or `processing`.

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect } from 'vitest'
import { topupTotal, countByType, nairaFromCoins, maskAccount, isInFlight } from './financeFormat'

const tx = [
  { id: 1, type: 'topup', naira_amount: 250000, status: 'completed' },
  { id: 2, type: 'topup', naira_amount: 50000, status: 'failed' },
  { id: 3, type: 'topup', naira_amount: null, status: 'pending' },
  { id: 4, type: 'withdrawal', naira_amount: 999999, status: 'completed' },
]

describe('financeFormat (legacy maths)', () => {
  it('topupTotal sums naira_amount of top-ups only, divides by 100, and ignores status', () => {
    expect(topupTotal(tx)).toBe(3000)
  })
  it('topupTotal of nothing is 0', () => expect(topupTotal([])).toBe(0))
  it('countByType counts rows of that type', () => {
    expect(countByType(tx, 'topup')).toBe(3)
    expect(countByType(tx, 'withdrawal')).toBe(1)
    expect(countByType(tx, 'refund')).toBe(0)
  })
  it('nairaFromCoins is amount * 200', () => {
    expect(nairaFromCoins(12)).toBe(2400)
    expect(nairaFromCoins(0)).toBe(0)
  })
  it('maskAccount keeps only the last four digits', () => {
    expect(maskAccount('0123456789')).toBe('••••6789')
    expect(maskAccount('1234')).toBe('••••1234')
  })
  it('maskAccount shows a dash when there is nothing sensible to mask', () => {
    expect(maskAccount(undefined)).toBe('—')
    expect(maskAccount('')).toBe('—')
    expect(maskAccount('12')).toBe('—')
  })
  it('isInFlight is reserved or processing only', () => {
    expect(isInFlight({ status: 'reserved' })).toBe(true)
    expect(isInFlight({ status: 'processing' })).toBe(true)
    expect(isInFlight({ status: 'completed' })).toBe(false)
    expect(isInFlight({ status: 'pending' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement**

```js
// The money arithmetic the Finance screens already did, moved verbatim so it can be
// tested. Nothing here is new maths: each helper reproduces what the legacy tab computed,
// including its quirks (the top-up total ignores status; coins convert at a fixed 200).

export const topupTotal = (transactions) =>
  transactions.filter(t => t.type === 'topup').reduce((s, t) => s + (t.naira_amount || 0), 0) / 100

export const countByType = (transactions, type) => transactions.filter(t => t.type === type).length

export const nairaFromCoins = (amount) => amount * 200

export const maskAccount = (number) => {
  const s = number == null ? '' : String(number)
  return s.length >= 4 ? `••••${s.slice(-4)}` : '—'
}

// A withdrawal is in flight while its coins are reserved and Paystack has not settled the transfer.
export const isInFlight = (w) => w.status === 'reserved' || w.status === 'processing'
```

- [ ] **Step 4: Run, expect PASS (7 tests).** Commit `feat(carefind): financeFormat, the legacy money maths pinned by tests`.

---

### Task 2: useFinanceData

**Files:**
- Create: `ADM/hooks/useFinanceData.js`, `ADM/hooks/useFinanceData.test.jsx`

**Interfaces:**
- Produces: `TRANSACTION_CAP = 50`; `loadFinance()` resolves `{ transactions, withdrawals }`, each `{ status:'ok', data:[...] }` or `{ status:'error' }` (a response without a list is an error); `useFinanceData(enabled = true)` is a `useQuery` with key `['admin','finance']`. Same shape and helpers as `ADM/hooks/useTrustQueues.js` (read it; mirror it).

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { loadFinance, TRANSACTION_CAP } from './useFinanceData'

beforeEach(() => { callAdminAuth.mockReset() })

describe('loadFinance', () => {
  it('settles each source on its own', async () => {
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'list_transactions') throw new Error('boom')
      if (action === 'list_withdrawal_requests') return { data: [{ id: 'w1' }] }
    })
    const r = await loadFinance()
    expect(r.transactions).toEqual({ status: 'error' })
    expect(r.withdrawals).toEqual({ status: 'ok', data: [{ id: 'w1' }] })
  })

  it('treats a response without a list as an error, never an empty list', async () => {
    callAdminAuth.mockResolvedValue({})
    const r = await loadFinance()
    expect(r.transactions.status).toBe('error')
    expect(r.withdrawals.status).toBe('error')
  })

  it('calls the two list actions with no payload', async () => {
    callAdminAuth.mockResolvedValue({ data: [] })
    await loadFinance()
    expect(callAdminAuth).toHaveBeenCalledWith('list_transactions')
    expect(callAdminAuth).toHaveBeenCalledWith('list_withdrawal_requests')
  })

  it('exposes the server cap for transactions', () => expect(TRANSACTION_CAP).toBe(50))
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (copy the `settle`/`list` helpers from `useTrustQueues.js`; `loadFinance` runs the two `list(...)` calls through `settle` in `Promise.all`; `useFinanceData(enabled = true)` returns `useQuery({ queryKey: ['admin','finance'], queryFn: loadFinance, enabled })`).
- [ ] **Step 4: Run, expect PASS (4 tests).** Commit `feat(carefind): useFinanceData, one settled state per money list`.

---

### Task 3: useReconciliation

**Files:**
- Create: `ADM/hooks/useReconciliation.js`, `ADM/hooks/useReconciliation.test.jsx`

**Interfaces:**
- Consumes: `callAdminAuth`; `useAdmin()` -> `showToast`, `invalidateAdmin`.
- Produces: `useReconciliationFindings(status)` — `useQuery` key `['admin','reconciliation', status]`; calls `callAdminAuth('admin_list_reconciliation', status === 'open' ? {} : { status })` and returns the `data` array; a response whose `data` is not an array rejects (never `[]`). `useReconciliationActions()` returns `{ busyId, running, updateFinding({ id, op, note }), runNow() }`:
  - `updateFinding` calls `callAdminAuth('admin_update_reconciliation_finding', { id, op, note })` (`note` only for `op === 'dismiss'`, else `undefined`), then `invalidateAdmin()` and toasts `'Finding dismissed'` / `'Finding acknowledged'` / `'Finding reopened'` (success type); resolves `{ ok: true }` or `{ ok: false, error }` (no toast on failure; the drawer shows it).
  - `runNow` calls `callAdminAuth('admin_run_reconciliation')`, then `invalidateAdmin()`, resolving `{ ok: true, summary }` where `summary` is built exactly like the legacy tab: with `t = report?.db?.totals` and `failed = report?.failed?.length ? ' Steps that failed: <list joined ", ">.' : ''` — `t ? 'Checked. {open_critical} critical, {open_warning} warning, {open_info} info open.' + failed : 'Run finished.' + failed`; on error resolves `{ ok: false, error }` and toasts `The check could not run: <message>` (error type), as legacy.

- [ ] **Step 1: Failing tests** (write in full, in the style of `useUserActions.test.jsx`): 
  1. the list hook sends `{}` for `open` and `{ status: 'dismissed' }` otherwise; returns the array; rejects (isError) on a failed call and on a non-array `data`.
  2. `updateFinding` dismiss sends `{ id, op:'dismiss', note }` and toasts 'Finding dismissed'; acknowledge sends `note: undefined`; reopen toasts 'Finding reopened'; failure resolves `{ ok:false, error }` with no toast and no invalidate; `busyId` is the finding id while pending and null after.
  3. `runNow` summary text for totals present, totals absent, and with `failed: ['a','b']`; an error toasts "The check could not run: …" and `running` clears.
  4. nothing calls any action other than the three named (assert the set of action names called across all tests).
- [ ] **Step 2: Run, expect FAIL.** Step 3: implement (mirror `useUserActions.js`). Step 4: PASS. Commit `feat(carefind): useReconciliation, money check findings and decisions`.

---

### Task 4: useWithdrawalActions

**Files:**
- Create: `ADM/hooks/useWithdrawalActions.js`, `ADM/hooks/useWithdrawalActions.test.jsx`

**Interfaces:**
- Produces: `useWithdrawalActions()` returns `{ busy, rejectWithdrawal(id) }`. `rejectWithdrawal(id)` calls `callAdminAuth('reject_withdrawal', { id })`. On success: `invalidateAdmin()`, toast `'Withdrawal rejected'` (success), resolve `{ ok: true }`. On error: **still** `invalidateAdmin()` (a 409 "confirmed paid" has changed the request), no toast, resolve `{ ok: false, error: err.message }`. No audit and no `recordAction` (the legacy inline handler wrote none; documented as a finding). `busy` is the id being rejected, cleared in `finally`.

- [ ] **Step 1: Failing tests** (write in full): success payload `{ id }` exactly and toast; error resolves `{ ok:false, error:'…' }`, DOES call `invalidateAdmin`, does NOT toast; `callAdminAuth` called exactly once per rejection (no audit call); `busy` lifecycle with a deferred promise inside `act`.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): useWithdrawalActions, the withdrawal reject moved out of LegacyTabHost`.

---

### Task 5: RevenueSection

**Files:**
- Create: `ADM/sections/RevenueSection.jsx`, `ADM/sections/RevenueSection.test.jsx`

**Interfaces:**
- Consumes: `useFinanceData`, `TRANSACTION_CAP`; `topupTotal`, `countByType` from `../lib/financeFormat`; `MetricStrip` (`ui/MetricStrip.jsx`: `items: [{ key, label, value, hint, status: 'ok'|'error'|'loading', onRetry }]`); the shared `DataTable` (columns `{ key, label, render }`, props `rows, columns, loading, error, onRetry, empty`), `StatusBadge`, `Button`, `Empty`; `timeAgo`, `exportCSV` from `../ui`.
- Produces: `<RevenueSection />`.

Behaviour: one h1 "Revenue", subtitle "Wallet transactions, latest 50". Three metrics from the transactions source only: **"Top-ups (latest 50)"** = `₦{topupTotal(rows).toLocaleString()}` with hint "Sum of top-ups of any status"; **"Top-up count (latest 50)"** = `countByType(rows,'topup')`; **"Withdrawal requests (latest 50)"** = `countByType(rows,'withdrawal')`. While the source loads each metric is `status: 'loading'`; if it failed each is `status: 'error'` with `onRetry = refetch` (never ₦0). Table heading "Latest {TRANSACTION_CAP} transactions"; columns Type (capitalised, `_` -> space), Description, Coins (`t.amount`), ₦ (`naira_amount / 100` formatted exactly as legacy: `₦{(t.naira_amount/100).toLocaleString()}` when present, else '—'), Status (`StatusBadge`), When (`timeAgo`). Empty: "No transactions in the latest 50". Failed: DataTable `error="Couldn't load transactions."` with Retry. Export button "Export CSV (latest 50)" calls `exportCSV(rows, 'transactions.csv')`, disabled with no rows.

- [ ] **Step 1: Failing test.** Mock `../hooks/useFinanceData` (settable result `{ data, isLoading, refetch }`; keep real `TRANSACTION_CAP` via `importActual`). Cases:
  1. one h1 "Revenue"; metric labels contain "(latest 50)"; with the Task-1 fixture the top-up card shows `₦3,000`, count 3, withdrawal count 1 (the legacy maths).
  2. a failed `transactions` source shows "Couldn't load" + Retry on every metric and the table, never `₦0`, never "No transactions in the latest 50"; Retry calls `refetch`.
  3. loading shows loading placeholders (role status "Loading …"), not numbers.
  4. empty list shows "No transactions in the latest 50" and ₦0 is acceptable here only because the source loaded.
  5. rows show the status badge text; a null `naira_amount` shows '—'.
  6. the Export button calls `exportCSV` with `(rows, 'transactions.csv')` and is disabled with no rows (mock `exportCSV` from `../ui` via `vi.mock('../ui', async () => ({ ...(await vi.importActual('../ui')), exportCSV }))`).
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): Revenue section with honestly labelled figures`.

---

### Task 6: OrdersSection

**Files:**
- Create: `ADM/sections/OrdersSection.jsx`, `ADM/sections/OrdersSection.test.jsx`

Behaviour (the legacy `OrdersTab` filtering preserved exactly): h1 "Orders", subtitle "Wallet transactions, latest 50". Source `useFinanceData().data.transactions`. Search box (aria-label "Search transactions", placeholder "Search within these 50…") matches `description` or `user_id` case-insensitively; status select (aria-label "Filter by status") with All statuses / Completed / Pending / Failed (exact legacy values `completed`, `pending`, `failed`); client-side paging, 15 per page, Previous/Next and "{n} results · page {p}/{total}"; Refresh button calls `refetch`. Columns: Type (capitalised), Description (truncated with `title`), Amount `₦{(naira_amount || 0).toLocaleString()}` (**exactly as legacy: not divided by 100**), Status (`StatusBadge`), Date (`toLocaleDateString`). A footnote under the table: "Amount as stored (naira_amount). Search and filters cover these 50 transactions only." Changing search or status resets to page 1. Failed source -> Retry, never "No transactions found"; empty (loaded, no match) -> "No transactions found".

- [ ] **Step 1: Failing test.** Mock `useFinanceData`. Cases (write in full): h1 and subtitle; search by description and by user id; status filter; page reset on search/filter change; paging with 16 rows (page 1 shows 15, Next shows 1, Previous disabled on page 1); the amount is NOT divided (a row with `naira_amount: 250000` shows `₦250,000`); footnote text present; failed source shows Retry and not "No transactions found"; empty match shows "No transactions found"; Refresh calls `refetch`.
- [ ] **Step 2: FAIL. Step 3: implement (use `DataTable` for the table; build paging from its `page`/`setPage`/`pageSize` props or your own pager, keep the 15-per-page and 1-indexed display). Step 4: PASS.** Commit `feat(carefind): Orders section, the transactions list with honest scope labels`.

---

### Task 7: WithdrawalsSection

**Files:**
- Create: `ADM/sections/WithdrawalsSection.jsx`, `ADM/sections/WithdrawalsSection.test.jsx`

**Interfaces:**
- Consumes: `useFinanceData`; `useWithdrawalActions`; `useAdmin().askConfirm`; `ReviewQueue` (read `ADM/ui/ReviewQueue.jsx` and `ADM/sections/ClaimsSection.jsx` first: props `title, source, onRetry, columns, isOpen, cap, nothingWaiting, noneYet, drawerTitle, renderDrawer(row,{close,setError}) -> { body, footer }, drawerStatus`); `isInFlight`, `nairaFromCoins`, `maskAccount`.
- Produces: `<WithdrawalsSection />`.

Behaviour: title "Withdrawals"; `source = data?.withdrawals`; `isOpen = isInFlight`; tabs are ReviewQueue's Pending/All (label them via the existing component; the pending tab means in progress — the empty text says "Nothing in progress", noneYet "No withdrawal requests yet"). Columns: Person (`profiles.full_name || profiles.display_name || 'User'`), Amount (`{amount} coins · about ₦{nairaFromCoins(amount).toLocaleString()} at 200 per coin`), Bank (`bank_name` + `maskAccount(account_number)`), Status (`StatusBadge`), Requested (`timeAgo`). `drawerTitle` = the person's name. Drawer body: details grid (Person, Amount as above, Bank name, **full** account number, Account name, Status, Requested date, Paystack reference only if the row has `paystack_reference`). Footer (only when `isInFlight`): "Reject and refund" -> `askConfirm({ title: 'Reject this withdrawal?', consequence, confirmLabel: 'Reject and refund', action })`. `consequence` (verified against `decideAdminReject`/`reject_withdrawal`): "Paystack is checked first. If the transfer failed, the coins are refunded to the user. If Paystack says it was paid, the request is recorded as paid and nothing is refunded. If the transfer is still in progress, the rejection is blocked." The confirm `action` calls `rejectWithdrawal(w.id)`: `{ ok:true }` -> `close()`; `{ ok:false, error }` -> `setError(error)` (the server's message, e.g. the 409 text) and the drawer stays open. Re-read the `reject_withdrawal` handler (`apps/carefind/api/_handlers/admin-auth.js` ~344-383) and `api/_lib/withdrawalAdmin.js` and correct the consequence text if it is not true.

- [ ] **Step 1: Failing test.** Mock `../hooks/useFinanceData`, `../hooks/useWithdrawalActions`, `../provider/AdminProvider.jsx` (`askConfirm`, `confirming: false`). Cases (write in full): in-progress rows by default and All shows completed ones; amount text "12 coins · about ₦2,400 at 200 per coin" for `amount: 12`; the table masks the account (`••••6789` and NOT the full number) while the drawer shows the full number; Reject appears only for `reserved`/`processing`; clicking it calls `askConfirm` with the consequence text and `confirmLabel: 'Reject and refund'` and does NOT call `rejectWithdrawal` until the confirm `action` runs, then it is called with exactly `'w1'`; `{ok:false,error:'Paystack says the transfer is still in progress'}` keeps the drawer open with that text in `role="alert"`; success closes it; failed list shows Retry and not "Nothing in progress"; empty All shows "No withdrawal requests yet".
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): Withdrawals section with masked accounts and a confirmed, truthful reject`.

---

### Task 8: MoneyChecksSection

**Files:**
- Create: `ADM/sections/MoneyChecksSection.jsx`, `ADM/sections/MoneyChecksSection.test.jsx`

**Interfaces:**
- Consumes: `useReconciliationFindings`, `useReconciliationActions`; `ReviewDrawer`; shared `DataTable`, `Button`, `StatusBadge`/text badges, `Empty`.
- Produces: `<MoneyChecksSection />`.

Behaviour (port of `ReconciliationTab`, same decisions, same wording): h1 "Money Checks", subtitle "Differences found between our books, the payment engines and Paystack". Status tabs (`role="tablist"`, aria-label "Finding status") Open / Acknowledged / Resolved / Dismissed (default `open`), each calls `useReconciliationFindings(status)`. Toolbar: "Refresh" (refetch) and "Run checks now" (`runNow`; label "Running…" and disabled while running; the returned `summary` is shown in a `role="status" aria-live="polite"` line; a failure is toasted by the hook). Open tab with critical findings (`severity === 'critical'` and status open/acknowledged) shows `role="alert"`: "{n} critical finding(s) need a decision." Table columns: Finding (`kind` with `_` -> space), Severity (text: Critical / Warning / Info), Status, Source / subject, Last seen. Row click and a "Review {kind}" button open the drawer. Drawer (title = kind): details (source, subject type, subject id, detail text, note when present, first/last seen, "seen N×"); footer buttons by status exactly as legacy: Acknowledge (status `open`), Dismiss… (`open` or `acknowledged`), Reopen (`resolved`, `dismissed`, `acknowledged`). Dismiss reveals a labelled textarea "Why is this explained? (kept on the record)" (maxLength 500) and a "Dismiss finding" submit disabled until the trimmed note has at least 5 characters; Cancel hides it. `updateFinding` results: ok -> close drawer; `{ok:false,error}` -> `setError(error)` and the drawer stays open. Loading shows a loading state; a failed list shows Retry (never the "Every check agrees" empty message); empty Open: "Nothing needs attention. Every check agrees."; other empties: "No {status} findings". This screen must never call any action other than the three reconciliation actions.

- [ ] **Step 1: Failing test.** First read `ADM/tabs/ReconciliationTab.test.jsx` (118 lines): port each of its cases to the new screen (list with severity/subject/detail and the critical alert; acknowledge, dismiss (note minimum), reopen; run now summary; empty; error + retry; "it must never act on money"), adapting the queries to the drawer flow, and ADD: the status tabs request `{}` for Open and `{ status: 'resolved' }` for Resolved; a failed list shows Retry and not "Every check agrees"; a failed update keeps the drawer open with the error; the Dismiss button stays disabled for a 4-character note and enables at 5 trimmed characters; the assertion that across the whole file the only action names called are the three reconciliation ones. Mock `../hooks/useReconciliation` (settable results) or mock `../adminApi` and run the real hooks — choose whichever lets the ported tests stay close to the originals, and say which in the report.
- [ ] **Step 2: FAIL. Step 3: implement. Step 4: PASS.** Commit `feat(carefind): Money checks section, the reconciliation findings with the same decisions`.

---

### Task 9: Wire the sections and retire the legacy code

**Files:**
- Modify: `ADM/AdminPanel.jsx`, `ADM/legacy/LegacyTabHost.jsx`, `ADM/AdminPanel.sections.test.jsx`
- Delete: `ADM/tabs/RevenueTab.jsx`, `ADM/tabs/OrdersTab.jsx`, `ADM/tabs/WithdrawalsTab.jsx`, `ADM/tabs/ReconciliationTab.jsx`, `ADM/tabs/ReconciliationTab.test.jsx`; and `ADM/components/StatusDot.jsx` / `ADM/components/RowActions.jsx` ONLY if a grep over `apps/carefind/src` shows no other importer.

- [ ] **Step 1: AdminPanel.** Import the four sections; in `ActiveSection` after the `isAllowed` check (which stays first) add branches for `revenue`, `orders`, `withdrawals`, `reconciliation` returning the matching section.
- [ ] **Step 2: LegacyTabHost.** Delete only dead code: the four tab imports and render lines (the `withdrawals` line includes an inline `onReject` handler: remove it with the line). Keep `transactions`, `withdrawals` in the adminData destructure only if still used elsewhere in the file (grep each). `loadAll` is used by OrdersTab only? — grep `loadAll` before removing `const loadAll = invalidateAdmin`; other tabs may use it. Grep every removed identifier and every import that may now be unused; a ReferenceError in `LegacyTabHost` would crash every legacy tab.
- [ ] **Step 3: Delete the old files**, then `grep -rn "RevenueTab\|OrdersTab\|WithdrawalsTab\|ReconciliationTab\|StatusDot\|RowActions" apps/carefind/src` and fix any importer (report what changed).
- [ ] **Step 4: Extend `AdminPanel.sections.test.jsx`** so `revenue`, `orders`, `withdrawals`, `reconciliation` route to their sections (not the legacy host) and fall back to the Overview when their permission is false.
- [ ] **Step 5: Verify** `npx vitest run src/modules/admin`, `npm run build`, `npm run lint` (0 errors); scan touched files for un-imported JSX components.
- [ ] **Step 6: Commit** `refactor(carefind): Revenue, Orders, Withdrawals and Money checks leave the legacy host`.

---

### Task 10: Docs

**Files:**
- Modify: `docs/ADMIN_REDESIGN.md` (docs only; no pushing, no PR, no full test suite)

- [ ] **Step 1:** Phase table: Phase 2b "built (PR #24)", Phase 3 "built on `feat/carefind-admin-phase3` (Revenue, Orders, Withdrawals, Money checks)"; keep 4-5. Code organisation: add `lib/financeFormat`, `hooks/useFinanceData`, `useReconciliation`, `useWithdrawalActions`, the four sections; note `transactions`/`withdrawals` stay in `useAdminData` (the Overview and notifications read them).
- [ ] **Step 2: Findings 45-52** (verify each fact with Read/Grep before stating it; use real commit SHAs from `git log --oneline feat/carefind-admin-phase2b..HEAD`):
  45. Revenue "Total Revenue"/"Top-ups"/"Withdrawals" were computed from the latest 50 transactions (server cap) and ignore status; they are not totals. Labelled, calculation unchanged.
  46. Revenue divides `naira_amount` by 100; Orders shows it undivided. One is wrong by 100x. Left as is and labelled; needs the backend owner.
  47. "Orders" lists wallet transactions, not shop orders, and sits under Marketplace in navigation.
  48. Withdrawals converts coins to naira with a hard-coded 200 per coin in the UI; labelled "about ₦X at 200 per coin".
  49. `list_transactions` and `list_withdrawal_requests` are readable by any valid admin token (Phase 1 finding 1 applies to money data); hiding the tabs is cosmetic.
  50. The legacy withdrawal reject toasted any server error and did not refresh, although a 409 "confirmed paid" had already settled the request. The new action refreshes. (Neither writes an audit row or action history for the reject; documented, unchanged.)
  51. Account numbers were shown in full in the list; the table now shows the last four digits and the drawer the full number.
  52. `reject_withdrawal` can record a request as paid (Paystack says the transfer succeeded) while returning HTTP 409; the confirmation now says so.
- [ ] **Step 3: Verification state:** Phase 3 covered by unit/component tests (list them); money figures pinned to the legacy maths; responsive widths NOT measured in a browser; the Paystack reject outcomes are read from the code, not exercised.
- [ ] **Step 4: Commit** `docs(carefind): Phase 3 state and findings 45-52`. Do not push or open a PR.

---

## Self-review

- **Spec coverage:** financeFormat pins the legacy maths (T1); the two money lists settle on their own (T2); reconciliation and withdrawal handlers move out with their exact payloads (T3-T4); four screens with the labelling table (T5-T8); legacy retirement and routing/permission tests (T9); findings 45-51 plus new 52 and the "no audit for reject" note (T10).
- **Spec deviations called out:** (a) the spec said `useWithdrawalActions` writes "the same audit and action history the legacy inline handler wrote" — the legacy inline handler wrote neither, so the plan keeps parity (none) and documents it; (b) `isInFlight` lives in `financeFormat` (the spec listed three helpers); (c) the reconciliation "run now" summary is returned by the hook for the section to display, as the legacy tab displayed it.
- **Known thin spots:** Tasks 5-8's section tests are given as exact case lists, not code (Phases 2a/2b needed fix rounds on exactly these); a reviewer should check them closely. Task 8 ports a 118-line existing test and the implementer must read it.
- **Type consistency:** `useFinanceData` data is `{ transactions, withdrawals }` of `{status,data}`; `ReviewQueue`'s `source` prop in T7 takes `data?.withdrawals`; `topupTotal`/`countByType` take the plain array (sections unwrap `source.data`); action hooks resolve `{ ok, error? }` as in Phases 2a/2b.
