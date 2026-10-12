# CareFind admin Phase 2a (trust queues) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Verification, Claims, Reports and Moderation out of `LegacyTabHost` into redesigned sections built on one reusable review queue (table, status filter, review drawer), and fix two Moderation bugs on the way.

**Architecture:** `useTrustQueues` loads the three lists with one settled state per source. `ReviewQueue` wraps the shared `DataTable` and `ReviewDrawer` (shared `Modal variant="drawer"`). `useReviewActions` holds the moved handlers. Four thin sections supply columns and drawer bodies. Same `callAdminAuth` actions and payloads as today.

**Tech Stack:** React, @tanstack/react-query, vitest + Testing Library (jsdom), `@care-ecosystem/design-system/components/ui`.

**Spec:** `docs/superpowers/specs/2026-10-12-carefind-admin-phase2a-design.md`

## Global Constraints

- All paths are relative to the worktree root. Admin dir = `apps/carefind/src/modules/admin/` (written `ADM/`). Run tests from `apps/carefind`: `npx vitest run <path>`.
- Branch `feat/carefind-admin-phase2a`. One commit per task, staged and committed in one command with explicit paths: `git add <paths> && git commit -m "..." -- <paths>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No backend, SQL, auth or financial change. Same `callAdminAuth` action names and payload fields as today. Never send a `token` field (`callAdminAuth` supplies the session).
- No UI-only permission check presented as security.
- A source that fails to load shows "Couldn't load" with Retry, never an empty list or zero.
- Reject, Delete and Dismiss labels do exactly what they say. Reject and Delete ask for confirmation through `useAdmin().askConfirm({ title, consequence, confirmLabel, action })`.
- ESLint has no React plugin: after writing JSX, check every component used is imported.
- Tests use `renderWithQueryClient` from `apps/carefind/src/test/renderWithQueryClient.jsx` (relative `../../../test/renderWithQueryClient.jsx` from `ADM/hooks`, `ADM/ui`, `ADM/sections`).

## Review Focus

- Report dismissal uses the **report** id, and every pending report on the same post is dismissed (Task 1, 4, 10).
- Bulk results name skipped and failed items; a mixed selection never reports unqualified success (Task 10).
- A queue source that fails shows Retry and never "Nothing waiting" (Task 6, 7).
- A row that disappears (resolved elsewhere, realtime refresh) while its drawer is open closes the drawer without crashing (Task 6).
- The credential tab is opened synchronously in the click, and a blocked popup produces a message, not silence (Task 4, 7).

---

### Task 1: Fix report ids in Moderation bulk actions (fix commit)

**Files:**
- Create: `ADM/lib/bulkModeration.js`, `ADM/lib/bulkModeration.test.js`
- Modify: `ADM/tabs/ModerationQueue.jsx` (the `report` branches of `handleBulkApprove` and `handleBulkReject`)

**Interfaces:**
- Produces: `reportsToResolve(item, reports)` returns the pending report rows to resolve for a Moderation `report` item.

- [ ] **Step 1: Write the failing test** `ADM/lib/bulkModeration.test.js`

```js
import { describe, it, expect } from 'vitest'
import { reportsToResolve } from './bulkModeration'

const item = (over = {}) => ({ id: 'p1', source: 'report', target_id: 'p1', raw: { id: 'r1', post_id: 'p1', status: 'pending' }, ...over })

describe('reportsToResolve', () => {
  it('returns every pending report on the same post, by report id', () => {
    const reports = [
      { id: 'r1', post_id: 'p1', status: 'pending' },
      { id: 'r2', post_id: 'p1', status: 'pending' },
      { id: 'r3', post_id: 'p1', status: 'resolved' },
      { id: 'r4', post_id: 'p2', status: 'pending' },
    ]
    expect(reportsToResolve(item(), reports).map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('never returns the post id as a report id', () => {
    const reports = [{ id: 'r1', post_id: 'p1', status: 'pending' }]
    expect(reportsToResolve(item(), reports).map(r => r.id)).not.toContain('p1')
  })

  it('returns nothing when every report on the post is already resolved', () => {
    expect(reportsToResolve(item(), [{ id: 'r1', post_id: 'p1', status: 'resolved' }])).toEqual([])
  })

  it('falls back to the item\'s own report when it has no post id', () => {
    const noPost = item({ id: 'r9', target_id: null, raw: { id: 'r9', post_id: null, status: 'pending' } })
    expect(reportsToResolve(noPost, []).map(r => r.id)).toEqual(['r9'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module './bulkModeration'`)

Run: `cd apps/carefind && npx vitest run src/modules/admin/lib/bulkModeration.test.js`

- [ ] **Step 3: Implement** `ADM/lib/bulkModeration.js`

```js
// A Moderation item for a reported post is keyed by the POST id (several
// reports on one post collapse into one item), but resolve_report takes a
// REPORT id. Resolve every pending report on the post, by its own id.
export function reportsToResolve(item, reports = []) {
  if (!item.target_id) return item.raw?.status === 'pending' ? [item.raw] : []
  return reports.filter(r => r.post_id === item.target_id && r.status === 'pending')
}
```

- [ ] **Step 4: Run, expect PASS** (4 tests)

- [ ] **Step 5: Use it in `ADM/tabs/ModerationQueue.jsx`.** Add `import { reportsToResolve } from '../lib/bulkModeration'`. In `handleBulkApprove` replace the report branch with:

```js
          } else if (item.source === 'report') {
            const toResolve = reportsToResolve(item, reports)
            if (toResolve.length === 0) { skipped++; continue }
            for (const rep of toResolve) {
              await callAdminAuth('resolve_report', { token, id: rep.id })
              await logAudit('resolve', 'report', rep.id, {})
            }
            approved++
```

Make the identical replacement in `handleBulkReject` (counter `rejected++`). Run `npx vitest run src/modules/admin` and expect all green.

- [ ] **Step 6: Commit**

```bash
git add apps/carefind/src/modules/admin/lib/bulkModeration.js apps/carefind/src/modules/admin/lib/bulkModeration.test.js apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx && git commit -m "fix(carefind): moderation bulk actions resolve reports by report id

Report items are keyed by post id; resolve_report was called with it.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -- apps/carefind/src/modules/admin/lib/bulkModeration.js apps/carefind/src/modules/admin/lib/bulkModeration.test.js apps/carefind/src/modules/admin/tabs/ModerationQueue.jsx
```

---

### Task 2: Bulk actions do what their labels say (fix commit)

**Files:**
- Modify: `ADM/components/BulkActionBar.jsx`, `ADM/tabs/ModerationQueue.jsx`
- Test: `ADM/components/BulkActionBar.test.jsx` (create)

**Interfaces:**
- Produces: `BulkActionBar` props `approveLabel`, `rejectLabel`, `deleteLabel`, `onDismiss`, `dismissLabel` (all optional; defaults keep the old labels).

- [ ] **Step 1: Failing test** `ADM/components/BulkActionBar.test.jsx`

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionBar } from './BulkActionBar'

describe('BulkActionBar', () => {
  it('renders nothing with no selection', () => {
    const { container } = render(<BulkActionBar selectedCount={0} onApprove={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('uses the labels it is given and calls the matching handler', () => {
    const onDismiss = vi.fn()
    render(<BulkActionBar selectedCount={2} onApprove={() => {}} approveLabel="Approve verifications" onReject={() => {}} rejectLabel="Reject verifications" onDismiss={onDismiss} dismissLabel="Dismiss reports" onDelete={() => {}} deleteLabel="Delete posts" />)
    expect(screen.getByRole('button', { name: 'Approve verifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject verifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete posts' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reports' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps the old labels by default', () => {
    render(<BulkActionBar selectedCount={1} onApprove={() => {}} />)
    expect(screen.getByRole('button', { name: 'Approve selected' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (the custom-label test fails)

- [ ] **Step 3: Implement.** In `BulkActionBar.jsx` change the signature to `({ selectedCount, onApprove, onReject, onDismiss, onDelete, onClear, approveLabel = 'Approve selected', rejectLabel = 'Reject selected', dismissLabel = 'Dismiss selected', deleteLabel = 'Delete selected' })`, replace the three hard-coded labels with `{approveLabel}`, `{rejectLabel}`, `{deleteLabel}`, and add, between the Reject and Delete buttons:

```jsx
        {onDismiss && (
          <button onClick={onDismiss} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {dismissLabel}
          </button>
        )}
```

- [ ] **Step 4: Run, expect PASS** (3 tests)

- [ ] **Step 5: Make `ModerationQueue.jsx` honest.**
  - `handleBulkApprove`: approve **verifications only**; the `report` branch becomes `skipped++`; skip message: ``Approved ${approved}, skipped ${skipped} (only verifications can be approved)``.
  - `handleBulkReject`: reject **verifications only**; the `report` branch becomes `skipped++`; skip message ``Rejected ${rejected}, skipped ${skipped} (only verifications can be rejected)``.
  - Add `handleBulkDismiss` copied from the Task 1 report branch: for each selected `item.source === 'report'` loop `reportsToResolve` and call `resolve_report`; other sources `skipped++`; message ``Dismissed ${n}, skipped ${m} (only reports can be dismissed)``.
  - Pass to the bar: `approveLabel="Approve verifications" rejectLabel="Reject verifications" onDismiss={handleBulkDismiss} dismissLabel="Dismiss reports" deleteLabel="Delete posts"`.

Run `npx vitest run src/modules/admin`, expect green.

- [ ] **Step 6: Commit** (`fix(carefind): moderation bulk actions do what their labels say`) with explicit paths for the four files.

---

### Task 3: useTrustQueues

**Files:**
- Create: `ADM/hooks/useTrustQueues.js`, `ADM/hooks/useTrustQueues.test.js`

**Interfaces:**
- Produces: `TRUST_CAPS = { reports: 30 }`; `loadTrustQueues()` resolves `{ verifications, claims, reports }`, each `{ status: 'ok', data: [...] }` or `{ status: 'error' }`; `useTrustQueues(enabled = true)` is a `useQuery` with key `['admin', 'trust-queues']`. The key starts with `admin`, so `invalidateAdmin()` and the realtime channels refresh it.

- [ ] **Step 1: Failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAdminAuth = vi.hoisted(() => vi.fn())
vi.mock('../adminApi', () => ({ callAdminAuth }))

import { loadTrustQueues, TRUST_CAPS } from './useTrustQueues'

beforeEach(() => callAdminAuth.mockReset())

describe('loadTrustQueues', () => {
  it('settles each source on its own', async () => {
    callAdminAuth.mockImplementation(async (action) => {
      if (action === 'list_verification_requests') return { data: [{ id: 'v1' }] }
      if (action === 'list_business_claims') throw new Error('boom')
      if (action === 'list_reports') return { data: [] }
    })
    const r = await loadTrustQueues()
    expect(r.verifications).toEqual({ status: 'ok', data: [{ id: 'v1' }] })
    expect(r.claims).toEqual({ status: 'error' })
    expect(r.reports).toEqual({ status: 'ok', data: [] })
  })

  it('treats a response without a list as an error, not an empty list', async () => {
    callAdminAuth.mockResolvedValue({})
    const r = await loadTrustQueues()
    expect(r.verifications.status).toBe('error')
  })

  it('exposes the server cap for reports', () => {
    expect(TRUST_CAPS.reports).toBe(30)
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```js
import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

// The three review queues. Each list settles on its own to
// { status: 'ok', data } or { status: 'error' }, so a failed list is shown as
// failed and never as an empty queue. The key starts with 'admin', so
// invalidateAdmin() and the realtime channels refresh it.

// The server returns at most this many rows (api/_handlers/admin-auth.js).
export const TRUST_CAPS = { reports: 30 }

const settle = async (promise) => {
  try { return { status: 'ok', data: await promise } } catch { return { status: 'error' } }
}

const list = (action) => callAdminAuth(action).then(r => {
  if (!Array.isArray(r?.data)) throw new Error(`${action} returned no list`)
  return r.data
})

export async function loadTrustQueues() {
  const [verifications, claims, reports] = await Promise.all([
    settle(list('list_verification_requests')),
    settle(list('list_business_claims')),
    settle(list('list_reports')),
  ])
  return { verifications, claims, reports }
}

export function useTrustQueues(enabled = true) {
  return useQuery({ queryKey: ['admin', 'trust-queues'], queryFn: loadTrustQueues, enabled })
}
```

- [ ] **Step 4: Run, expect PASS.** Commit `feat(carefind): useTrustQueues, one settled state per review queue`.

---

### Task 4: useReviewActions

**Files:**
- Create: `ADM/hooks/useReviewActions.js`, `ADM/hooks/useReviewActions.test.jsx`

**Interfaces:**
- Consumes: `useAdmin()` → `showToast`, `invalidateAdmin`, `recordAction`; `callAdminAuth` from `../adminApi`.
- Produces: `useReviewActions()` returns `{ busyId, approveVerification({ id, userId, profession }), rejectVerification(id), approveClaim({ id, businessId }), rejectClaim(id), resolveReport(id), deletePost(postId), openCredential(requestId) }`. Every action except `openCredential` resolves `{ ok: true }` or `{ ok: false, error }`; success toasts and invalidates, failure toasts nothing (the caller shows `error` inline). `openCredential` resolves `{ ok, error? }`.

- [ ] **Step 1: Failing test** (`useReviewActions.test.jsx`)

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const callAdminAuth = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn(), recordAction: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useReviewActions } from './useReviewActions'

beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  Object.values(admin).forEach(f => f.mockReset())
})

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }

describe('useReviewActions', () => {
  it('approves a verification with the same payload as before and audits it', async () => {
    const { result } = renderHook(() => useReviewActions())
    const out = await run(() => result.current.approveVerification({ id: 'v1', userId: 'u1', profession: 'Pharmacist' }))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('approve_verification', { id: 'v1', userId: 'u1', profession: 'Pharmacist' })
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({ auditAction: 'approve', targetType: 'verification', targetId: 'v1' }))
    expect(admin.invalidateAdmin).toHaveBeenCalled()
    expect(admin.showToast).toHaveBeenCalledWith('Verification approved', { type: 'success' })
  })

  it('rejects a verification, approves and rejects a claim', async () => {
    const { result } = renderHook(() => useReviewActions())
    await run(() => result.current.rejectVerification('v2'))
    await run(() => result.current.approveClaim({ id: 'c1', businessId: 'b1' }))
    await run(() => result.current.rejectClaim('c2'))
    expect(callAdminAuth).toHaveBeenCalledWith('reject_verification', { id: 'v2' })
    expect(callAdminAuth).toHaveBeenCalledWith('approve_claim', { claimId: 'c1', businessId: 'b1' })
    expect(callAdminAuth).toHaveBeenCalledWith('reject_claim', { claimId: 'c2' })
  })

  it('dismisses a report by its REPORT id', async () => {
    const { result } = renderHook(() => useReviewActions())
    await run(() => result.current.resolveReport('r1'))
    expect(callAdminAuth).toHaveBeenCalledWith('resolve_report', { id: 'r1' })
  })

  it('deletes a post by post id', async () => {
    const { result } = renderHook(() => useReviewActions())
    await run(() => result.current.deletePost('p1'))
    expect(callAdminAuth).toHaveBeenCalledWith('delete_post', { id: 'p1' })
  })

  it('returns the error and does not invalidate or toast success on failure', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('Not allowed'))
    const { result } = renderHook(() => useReviewActions())
    const out = await run(() => result.current.approveClaim({ id: 'c1', businessId: 'b1' }))
    expect(out).toEqual({ ok: false, error: 'Not allowed' })
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('a failing audit write does not fail the action', async () => {
    callAdminAuth.mockImplementation(async (a) => { if (a === 'log_audit_action') throw new Error('audit down'); return {} })
    const { result } = renderHook(() => useReviewActions())
    const out = await run(() => result.current.rejectClaim('c1'))
    expect(out.ok).toBe(true)
  })

  it('opens the credential tab synchronously, then points it at the signed URL', async () => {
    const tab = { location: '', close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab)
    callAdminAuth.mockResolvedValueOnce({ url: 'https://signed.example/doc' })
    const { result } = renderHook(() => useReviewActions())
    const out = await run(() => result.current.openCredential('v1'))
    expect(open).toHaveBeenCalledWith('', '_blank', 'noopener,noreferrer')
    expect(callAdminAuth).toHaveBeenCalledWith('credential_url', { requestId: 'v1' })
    expect(tab.location).toBe('https://signed.example/doc')
    expect(out.ok).toBe(true)
    open.mockRestore()
  })

  it('says so when the browser blocks the popup', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    callAdminAuth.mockResolvedValueOnce({ url: 'https://signed.example/doc' })
    const { result } = renderHook(() => useReviewActions())
    const out = await run(() => result.current.openCredential('v1'))
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/blocked/i)
    open.mockRestore()
  })

  it('closes the blank tab and reports the error when signing fails', async () => {
    const tab = { location: '', close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab)
    callAdminAuth.mockRejectedValueOnce(new Error('no file'))
    const { result } = renderHook(() => useReviewActions())
    const out = await run(() => result.current.openCredential('v1'))
    expect(tab.close).toHaveBeenCalled()
    expect(out).toEqual({ ok: false, error: 'Could not open the document: no file' })
    open.mockRestore()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `ADM/hooks/useReviewActions.js`

```js
import { useCallback, useState } from 'react'
import { callAdminAuth } from '../adminApi'
import { useAdmin } from '../provider/AdminProvider.jsx'

// The review actions that used to live in LegacyTabHost, unchanged in what they
// call. Each resolves { ok } or { ok: false, error } so the drawer can show the
// failure where the admin is looking; success toasts and refreshes the lists.

async function audit(auditAction, targetType, targetId, metadata = {}) {
  try {
    await callAdminAuth('log_audit_action', { auditAction, targetType, targetId, metadata })
  } catch { /* an audit failure must not block moderation */ }
}

export function useReviewActions() {
  const { showToast, invalidateAdmin, recordAction } = useAdmin()
  const [busyId, setBusyId] = useState(null)

  const run = useCallback(async ({ id, action, payload, auditAs, record, success, metadata }) => {
    setBusyId(id)
    try {
      await callAdminAuth(action, payload)
      audit(auditAs[0], auditAs[1], id, metadata)
      recordAction({ action: record[0], target: record[1], id, timestamp: new Date().toISOString() })
      invalidateAdmin()
      showToast(success, { type: 'success' })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    } finally {
      setBusyId(null)
    }
  }, [showToast, invalidateAdmin, recordAction])

  const approveVerification = ({ id, userId, profession }) => run({
    id, action: 'approve_verification', payload: { id, userId, profession },
    auditAs: ['approve', 'verification'], record: ['approve', 'verification'], metadata: { userId, profession },
    success: 'Verification approved',
  })
  const rejectVerification = (id) => run({
    id, action: 'reject_verification', payload: { id },
    auditAs: ['reject', 'verification'], record: ['reject', 'verification'], success: 'Verification rejected',
  })
  const approveClaim = ({ id, businessId }) => run({
    id, action: 'approve_claim', payload: { claimId: id, businessId },
    auditAs: ['approve', 'claim'], record: ['approve', 'claim'], metadata: { businessId }, success: 'Claim approved',
  })
  const rejectClaim = (id) => run({
    id, action: 'reject_claim', payload: { claimId: id },
    auditAs: ['reject', 'claim'], record: ['reject', 'claim'], success: 'Claim rejected',
  })
  const resolveReport = (id) => run({
    id, action: 'resolve_report', payload: { id },
    auditAs: ['resolve', 'report'], record: ['approve', 'report'], success: 'Report resolved',
  })
  const deletePost = (id) => run({
    id, action: 'delete_post', payload: { id },
    auditAs: ['delete', 'post'], record: ['reject', 'post'], success: 'Post deleted',
  })

  // Resolve a private credential document to a short-lived signed URL. The tab
  // is opened SYNCHRONOUSLY inside the click's user-activation window and then
  // pointed at the URL; window.open after an await is blocked by Chrome/Safari.
  const openCredential = useCallback(async (requestId) => {
    setBusyId(requestId)
    const tab = window.open('', '_blank', 'noopener,noreferrer')
    try {
      const { url } = await callAdminAuth('credential_url', { requestId })
      if (!tab) return { ok: false, error: 'Your browser blocked the document window. Allow popups for this site and try again.' }
      tab.location = url
      return { ok: true }
    } catch (err) {
      if (tab) tab.close()
      return { ok: false, error: `Could not open the document: ${err.message}` }
    } finally {
      setBusyId(null)
    }
  }, [])

  return { busyId, approveVerification, rejectVerification, approveClaim, rejectClaim, resolveReport, deletePost, openCredential }
}
```

- [ ] **Step 4: Run, expect PASS (9 tests).** Commit `feat(carefind): useReviewActions, the review handlers moved out of LegacyTabHost`.

---

### Task 5: ReviewDrawer

**Files:**
- Create: `ADM/ui/ReviewDrawer.jsx`, `ADM/ui/ReviewDrawer.test.jsx`

**Interfaces:**
- Produces: `<ReviewDrawer show title status onClose error footer>children</ReviewDrawer>`. Wraps the shared `Modal variant="drawer"`, whose focus contract already traps Tab, closes on Esc and returns focus to the opener. At 500px and below the drawer fills the viewport width; it is always full height.

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReviewDrawer from './ReviewDrawer.jsx'

describe('ReviewDrawer', () => {
  it('renders nothing when closed', () => {
    render(<ReviewDrawer show={false} title="Amina" onClose={() => {}}>body</ReviewDrawer>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows title, status, body and footer', () => {
    render(<ReviewDrawer show title="Amina Yusuf" status="pending" onClose={() => {}} footer={<button>Approve</button>}>Pharmacist</ReviewDrawer>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Amina Yusuf')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Pharmacist')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn()
    render(<ReviewDrawer show title="x" onClose={onClose}>b</ReviewDrawer>)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows an action error inline as an alert', () => {
    render(<ReviewDrawer show title="x" onClose={() => {}} error="Not allowed">b</ReviewDrawer>)
    expect(screen.getByRole('alert')).toHaveTextContent('Not allowed')
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```jsx
import { Modal, StatusBadge } from '@care-ecosystem/design-system/components/ui'

// The review drawer. Focus trap, Escape, and focus return are the shared
// Modal's contract; this adds the status badge and an inline error so a failed
// action is read where the admin is looking, with the drawer still open.
export default function ReviewDrawer({ show, title, status, onClose, error, footer, children }) {
  return (
    <Modal
      show={show}
      onClose={onClose}
      variant="drawer"
      size="lg"
      title={<span className="adm-drawer-title">{title}{status ? <StatusBadge status={status} /> : null}</span>}
      footer={footer}
    >
      {error ? <div role="alert" className="adm-drawer-error">{error}</div> : null}
      {children}
    </Modal>
  )
}
```

Append to `ADM/ui/admin.css`:

```css
.adm-drawer-title { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.adm-drawer-error { padding: 10px 12px; margin-bottom: 14px; border-radius: 8px; background: var(--adm-danger-bg, #fdecea); color: var(--adm-danger, #b42318); font-size: 13px; }
.adm-drawer-grid { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0 0 16px; font-size: 13px; }
.adm-drawer-grid dt { color: var(--adm-muted, #6b7280); font-weight: 600; }
.adm-drawer-grid dd { margin: 0; overflow-wrap: anywhere; }
.adm-drawer-text { padding: 12px; border-radius: 8px; background: var(--adm-surface-2, #f5f4ef); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; }
```

If `--adm-*` tokens named differently, use the names defined at the top of `admin.css`.

- [ ] **Step 4: Run, expect PASS (4 tests).** Commit `feat(carefind): ReviewDrawer on the shared drawer Modal`.

---

### Task 6: ReviewQueue

**Files:**
- Create: `ADM/ui/ReviewQueue.jsx`, `ADM/ui/ReviewQueue.test.jsx`

**Interfaces:**
- Consumes: `DataTable`, `Empty`, `Button` from the design system; `ReviewDrawer`.
- Produces: `<ReviewQueue>` with props
  `title` (h1 text), `source` (`{ status: 'ok'|'error', data }` or `undefined` while loading), `onRetry`, `columns` (DataTable columns), `isOpen(row)` (true when the row is waiting), `cap` (number or undefined), `nothingWaiting` (string), `noneYet` (string), `drawerTitle(row)`, `renderDrawer(row, { close, setError })` returning `{ body, footer }`, `toolbar` (optional node), `rowId(row)` (default `row.id`).
  Behaviour: loading → skeleton via DataTable `loading`; `source.status === 'error'` → DataTable `error` + Retry; filter tabs Pending (default) and All; count text; `N+` and a note when `cap` is reached; each row has a "Review" button so the drawer is keyboard reachable; clicking a row also opens it; if the open row's id leaves `source.data`, the drawer closes.

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReviewQueue from './ReviewQueue.jsx'

const rows = [
  { id: 'a', name: 'Amina', status: 'pending' },
  { id: 'b', name: 'Bola', status: 'approved' },
]
const columns = [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }]

function setup(over = {}) {
  const props = {
    title: 'Verification', source: { status: 'ok', data: rows }, onRetry: vi.fn(), columns,
    isOpen: r => r.status === 'pending', nothingWaiting: 'Nothing waiting', noneYet: 'No requests yet',
    drawerTitle: r => r.name,
    renderDrawer: (r) => ({ body: <p>Details for {r.name}</p>, footer: <button>Approve</button> }),
    ...over,
  }
  return { props, ...render(<ReviewQueue {...props} />) }
}

describe('ReviewQueue', () => {
  it('has one h1 and defaults to the pending rows', () => {
    setup()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.queryByText('Bola')).not.toBeInTheDocument()
  })

  it('All shows every row', () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('Bola')).toBeInTheDocument()
  })

  it('shows a Retry, not an empty message, when the source failed', () => {
    const { props } = setup({ source: { status: 'error' } })
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(props.onRetry).toHaveBeenCalled()
  })

  it('says nothing is waiting only when the source loaded and no row is open', () => {
    setup({ source: { status: 'ok', data: [rows[1]] } })
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument()
  })

  it('says none yet under All when the list is empty', () => {
    setup({ source: { status: 'ok', data: [] } })
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('No requests yet')).toBeInTheDocument()
  })

  it('shows N+ and a note when the list reaches the server cap', () => {
    setup({ cap: 2 })
    expect(screen.getByText(/2\+/)).toBeInTheDocument()
    expect(screen.getByText(/may be older items/i)).toBeInTheDocument()
  })

  it('opens the drawer from the Review button and closes it', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Details for Amina')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the drawer when its row disappears from the list', () => {
    const { props, rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina' }))
    rerender(<ReviewQueue {...props} source={{ status: 'ok', data: [rows[1]] }} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `ADM/ui/ReviewQueue.jsx`

```jsx
import { useEffect, useMemo, useState } from 'react'
import { Button, DataTable, Empty } from '@care-ecosystem/design-system/components/ui'
import ReviewDrawer from './ReviewDrawer.jsx'
import './admin.css'

// One review queue for Verification, Claims and Reports: status tabs, the
// shared DataTable, and a drawer for the full request. A list that failed shows
// as failed, never as an empty queue.
export default function ReviewQueue({
  title, source, onRetry, columns, isOpen, cap, nothingWaiting, noneYet,
  drawerTitle, renderDrawer, toolbar, rowId = r => r.id, drawerStatus = r => r.status,
}) {
  const [view, setView] = useState('pending')
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')

  const loading = !source
  const failed = source?.status === 'error'
  const all = source?.status === 'ok' ? source.data : []
  const waiting = useMemo(() => all.filter(isOpen), [all, isOpen])
  const rows = view === 'pending' ? waiting : all
  const atCap = cap != null && all.length >= cap

  const current = openId == null ? null : all.find(r => rowId(r) === openId) || null
  // The row was resolved elsewhere (or the list refreshed without it).
  useEffect(() => { if (openId != null && !loading && !current) { setOpenId(null); setError('') } }, [openId, loading, current])

  const open = (row) => { setError(''); setOpenId(rowId(row)) }
  const close = () => { setOpenId(null); setError('') }
  const drawer = current ? renderDrawer(current, { close, setError }) : null

  const empty = <Empty message={view === 'pending' ? nothingWaiting : noneYet} cause="none" />

  return (
    <div className="adm-page">
      <div className="adm-head">
        <h1>{title}</h1>
        {toolbar}
      </div>

      <div role="tablist" aria-label={`${title} filter`} className="adm-tabs">
        <button role="tab" aria-selected={view === 'pending'} onClick={() => setView('pending')}>
          Pending{!loading && !failed ? ` (${waiting.length}${atCap ? '+' : ''})` : ''}
        </button>
        <button role="tab" aria-selected={view === 'all'} onClick={() => setView('all')}>
          All{!loading && !failed ? ` (${all.length}${atCap ? '+' : ''})` : ''}
        </button>
      </div>
      {atCap && <p className="adm-note">The server returns at most {cap} items, so there may be older items not shown.</p>}

      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={failed ? "Couldn't load this list." : undefined}
        onRetry={onRetry}
        empty={empty}
        onRowClick={open}
        actions={(row) => (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); open(row) }} aria-label={`Review ${drawerTitle(row)}`}>
            Review
          </Button>
        )}
      />

      <ReviewDrawer show={!!current} title={current ? drawerTitle(current) : ''} status={current ? drawerStatus(current) : undefined} onClose={close} error={error} footer={drawer?.footer}>
        {drawer?.body}
      </ReviewDrawer>
    </div>
  )
}
```

Append `.adm-tabs`, `.adm-tabs [aria-selected="true"]` and `.adm-note` styles to `admin.css` using the existing `--adm-*` tokens (tabs: inline-flex, 8px gap, 36px min-height, selected = teal underline; note: 12px muted).

If `ErrorState` shows its own Retry label other than "Retry", adjust the test's `/retry/i` matcher to the shown label.

- [ ] **Step 4: Run, expect PASS (8 tests).** Commit `feat(carefind): ReviewQueue on the shared DataTable and ReviewDrawer`.

---

### Task 7: VerificationsSection

**Files:**
- Create: `ADM/sections/VerificationsSection.jsx`, `ADM/sections/VerificationsSection.test.jsx`

**Interfaces:**
- Consumes: `useTrustQueues`, `useReviewActions`, `useAdmin().askConfirm`, `ReviewQueue`, `timeAgo` from `../ui`.
- Produces: `<VerificationsSection />` (no props).

- [ ] **Step 1: Failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const queues = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({
  approveVerification: vi.fn(), rejectVerification: vi.fn(), openCredential: vi.fn(), busyId: null,
}))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn() }))
vi.mock('../hooks/useTrustQueues', () => ({ useTrustQueues: () => ({ data: queues.value, refetch: queues.refetch }) }))
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import VerificationsSection from './VerificationsSection.jsx'

const v = (over = {}) => ({ id: 'v1', status: 'pending', full_name: 'Amina Yusuf', profession: 'Pharmacist', workplace: 'Garki Pharmacy', phone: '0803', user_id: 'u1', credential_url: 'x', created_at: new Date().toISOString(), ...over })

beforeEach(() => {
  queues.value = { verifications: { status: 'ok', data: [v(), v({ id: 'v2', status: 'approved', full_name: 'Bola' })] }, claims: { status: 'ok', data: [] }, reports: { status: 'ok', data: [] } }
  actions.approveVerification.mockReset().mockResolvedValue({ ok: true })
  actions.rejectVerification.mockReset().mockResolvedValue({ ok: true })
  actions.openCredential.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
})

describe('VerificationsSection', () => {
  it('lists pending requests by default', () => {
    render(<VerificationsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Verification' })).toBeInTheDocument()
    expect(screen.getByText('Amina Yusuf')).toBeInTheDocument()
    expect(screen.queryByText('Bola')).not.toBeInTheDocument()
  })

  it('approves from the drawer with the same payload and closes on success', async () => {
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(actions.approveVerification).toHaveBeenCalledWith({ id: 'v1', userId: 'u1', profession: 'Pharmacist' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('asks for confirmation before rejecting, and does not reject until confirmed', () => {
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reject' }))
    expect(actions.rejectVerification).not.toHaveBeenCalled()
    admin.askConfirm.mock.calls[0][0].action()
    expect(actions.rejectVerification).toHaveBeenCalledWith('v1')
  })

  it('keeps the drawer open and shows the error when approve fails', async () => {
    actions.approveVerification.mockResolvedValue({ ok: false, error: 'Not allowed' })
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows a credential error from openCredential in the drawer', async () => {
    actions.openCredential.mockResolvedValue({ ok: false, error: 'Your browser blocked the document window.' })
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina Yusuf' }))
    fireEvent.click(screen.getByRole('button', { name: /view credential/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked/i)
  })

  it('has no Approve or Reject for an already decided request', () => {
    render(<VerificationsSection />)
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Bola' }))
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows Retry when the list failed to load', () => {
    queues.value = { ...queues.value, verifications: { status: 'error' } }
    render(<VerificationsSection />)
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```jsx
import { Button } from '@care-ecosystem/design-system/components/ui'
import { StatusBadge } from '@care-ecosystem/design-system/components/ui'
import ReviewQueue from '../ui/ReviewQueue.jsx'
import { timeAgo } from '../ui'
import { useTrustQueues } from '../hooks/useTrustQueues'
import { useReviewActions } from '../hooks/useReviewActions'
import { useAdmin } from '../provider/AdminProvider.jsx'

const isOpen = (v) => v.status === 'pending'

const columns = [
  { key: 'full_name', label: 'Applicant' },
  { key: 'profession', label: 'Profession' },
  { key: 'workplace', label: 'Workplace', render: v => v.workplace || '—' },
  { key: 'created_at', label: 'Submitted', sortable: true, sortValue: v => new Date(v.created_at).getTime(), render: v => timeAgo(v.created_at) },
  { key: 'status', label: 'Status', render: v => <StatusBadge status={v.status} /> },
]

export default function VerificationsSection() {
  const { data, refetch } = useTrustQueues(true)
  const actions = useReviewActions()
  const { askConfirm } = useAdmin()

  const renderDrawer = (v, { close, setError }) => {
    const finish = (res) => { if (res.ok) close(); else setError(res.error) }
    const pending = v.status === 'pending'
    return {
      body: (
        <>
          <dl className="adm-drawer-grid">
            <dt>Applicant</dt><dd>{v.full_name}</dd>
            <dt>Profession</dt><dd>{v.profession}</dd>
            <dt>Workplace</dt><dd>{v.workplace || '—'}</dd>
            <dt>Phone</dt><dd>{v.phone || '—'}</dd>
            <dt>Submitted</dt><dd>{timeAgo(v.created_at)}</dd>
          </dl>
          {v.credential_url && (
            <Button variant="ghost" size="sm" loading={actions.busyId === v.id} loadingText="Opening…"
              onClick={async () => { const res = await actions.openCredential(v.id); if (!res.ok) setError(res.error); else setError('') }}>
              View credential
            </Button>
          )}
        </>
      ),
      footer: pending ? (
        <>
          <Button variant="primary" fullWidth loading={actions.busyId === v.id}
            onClick={async () => finish(await actions.approveVerification({ id: v.id, userId: v.user_id, profession: v.profession }))}>
            Approve
          </Button>
          <Button variant="danger" fullWidth
            onClick={() => askConfirm({
              title: `Reject ${v.full_name}'s verification?`,
              consequence: 'The applicant is told their verification was not approved. They can submit a new request.',
              confirmLabel: 'Reject',
              action: async () => finish(await actions.rejectVerification(v.id)),
            })}>
            Reject
          </Button>
        </>
      ) : null,
    }
  }

  return (
    <ReviewQueue
      title="Verification"
      source={data?.verifications}
      onRetry={refetch}
      columns={columns}
      isOpen={isOpen}
      nothingWaiting="Nothing waiting"
      noneYet="No requests yet"
      drawerTitle={v => v.full_name}
      renderDrawer={renderDrawer}
    />
  )
}
```

Check the sentence in `consequence` against what `reject_verification` actually does (read `api/_handlers/admin-auth.js`); if it does not notify the applicant, drop that clause and say only what is true.

Merge the two design-system imports into one line.

- [ ] **Step 4: Run, expect PASS (7 tests).** Commit `feat(carefind): Verification section on the review queue`.

---

### Task 8: ClaimsSection

**Files:**
- Create: `ADM/sections/ClaimsSection.jsx`, `ADM/sections/ClaimsSection.test.jsx`

- [ ] **Step 1: Failing test** `ClaimsSection.test.jsx`

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const queues = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({ approveClaim: vi.fn(), rejectClaim: vi.fn(), busyId: null }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn() }))
vi.mock('../hooks/useTrustQueues', () => ({ useTrustQueues: () => ({ data: queues.value, refetch: queues.refetch }) }))
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import ClaimsSection from './ClaimsSection.jsx'

const claim = (over = {}) => ({ id: 'c1', business_id: 'b1', status: 'pending', businesses: { name: 'Garki Pharmacy' }, created_at: new Date().toISOString(), ...over })

beforeEach(() => {
  queues.value = {
    verifications: { status: 'ok', data: [] }, reports: { status: 'ok', data: [] },
    claims: { status: 'ok', data: [claim(), claim({ id: 'c2', status: 'approved', businesses: { name: 'Wuse Clinic' } })] },
  }
  actions.approveClaim.mockReset().mockResolvedValue({ ok: true })
  actions.rejectClaim.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
})

describe('ClaimsSection', () => {
  it('lists pending claims by default', () => {
    render(<ClaimsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Claims' })).toBeInTheDocument()
    expect(screen.getByText('Garki Pharmacy')).toBeInTheDocument()
    expect(screen.queryByText('Wuse Clinic')).not.toBeInTheDocument()
  })

  it('approves from the drawer and closes it', async () => {
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Garki Pharmacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(actions.approveClaim).toHaveBeenCalledWith({ id: 'c1', businessId: 'b1' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rejects only after the confirmation runs', () => {
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Garki Pharmacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Reject' }))
    expect(actions.rejectClaim).not.toHaveBeenCalled()
    admin.askConfirm.mock.calls[0][0].action()
    expect(actions.rejectClaim).toHaveBeenCalledWith('c1')
  })

  it('keeps the drawer open and shows the error when approve fails', async () => {
    actions.approveClaim.mockResolvedValue({ ok: false, error: 'Not allowed' })
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Garki Pharmacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers no decision on a claim that is already decided', () => {
    render(<ClaimsSection />)
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Wuse Clinic' }))
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows Retry, not an empty queue, when the list failed', () => {
    queues.value = { ...queues.value, claims: { status: 'error' } }
    render(<ClaimsSection />)
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** following Task 7: `columns` = business (`c.businesses?.name || 'Unnamed business'`), submitted, status; `isOpen = c => c.status === 'pending'`; drawer body = `<dl>` with Business and Submitted; footer Approve (`actions.approveClaim({ id: c.id, businessId: c.business_id })`) and Reject with `askConfirm({ title: 'Reject this claim?', consequence: 'The business stays unclaimed. The claimant can submit another claim.', confirmLabel: 'Reject', action })`; `drawerTitle = c => c.businesses?.name || 'Business claim'`; title "Claims"; `nothingWaiting="Nothing waiting"`, `noneYet="No claims yet"`. Verify the `consequence` text against `reject_claim` in `api/_handlers/admin-auth.js` and say only what is true.

- [ ] **Step 4: Run, expect PASS.** Commit `feat(carefind): Claims section on the review queue`.

---

### Task 9: ReportsSection

**Files:**
- Create: `ADM/sections/ReportsSection.jsx`, `ADM/sections/ReportsSection.test.jsx`

- [ ] **Step 1: Failing test** `ReportsSection.test.jsx`

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const queues = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
const actions = vi.hoisted(() => ({ resolveReport: vi.fn(), deletePost: vi.fn(), busyId: null }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn() }))
vi.mock('../hooks/useTrustQueues', async () => {
  const actual = await vi.importActual('../hooks/useTrustQueues')
  return { ...actual, useTrustQueues: () => ({ data: queues.value, refetch: queues.refetch }) }
})
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import ReportsSection from './ReportsSection.jsx'

const now = new Date().toISOString()
const LONG = 'A'.repeat(300)
const rep = (over = {}) => ({ id: 'r1', post_id: 'p1', status: 'pending', reason: 'spam', posts: { content: 'Buy cheap pills now' }, created_at: now, ...over })
const setReports = (data) => { queues.value = { verifications: { status: 'ok', data: [] }, claims: { status: 'ok', data: [] }, reports: data } }

beforeEach(() => {
  setReports({ status: 'ok', data: [rep(), rep({ id: 'r2', post_id: 'p2', status: 'resolved', reason: 'abuse', posts: { content: 'Old post' } })] })
  actions.resolveReport.mockReset().mockResolvedValue({ ok: true })
  actions.deletePost.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
})

describe('ReportsSection', () => {
  it('lists pending reports with the post excerpt', () => {
    render(<ReportsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByText('Buy cheap pills now')).toBeInTheDocument()
    expect(screen.queryByText('Old post')).not.toBeInTheDocument()
  })

  it('dismisses by the REPORT id, never the post id', async () => {
    render(<ReportsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(actions.resolveReport).toHaveBeenCalledWith('r1'))
    expect(actions.resolveReport).not.toHaveBeenCalledWith('p1')
  })

  it('deletes the post only after confirmation, by post id', async () => {
    render(<ReportsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Delete post' }))
    expect(actions.deletePost).not.toHaveBeenCalled()
    await admin.askConfirm.mock.calls[0][0].action()
    expect(actions.deletePost).toHaveBeenCalledWith('p1')
  })

  it('shows the full post in the drawer but truncates it in the table', () => {
    setReports({ status: 'ok', data: [rep({ posts: { content: LONG } })] })
    render(<ReportsSection />)
    expect(screen.queryByText(LONG)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    expect(screen.getByText(LONG)).toBeInTheDocument()
  })

  it('offers only Dismiss when the post is already gone', () => {
    setReports({ status: 'ok', data: [rep({ posts: null })] })
    render(<ReportsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Review spam' }))
    expect(screen.getByText('Post no longer available', { selector: '.adm-drawer-text' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('shows the cap note when the server returned its maximum', () => {
    setReports({ status: 'ok', data: Array.from({ length: 30 }, (_, i) => rep({ id: `r${i}`, post_id: `p${i}` })) })
    render(<ReportsSection />)
    expect(screen.getByText(/30\+/)).toBeInTheDocument()
  })

  it('shows Retry when the list failed', () => {
    setReports({ status: 'error' })
    render(<ReportsSection />)
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
```

The row's accessible Review label comes from `drawerTitle(r)`, so for Reports `drawerTitle = r => r.reason`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** `columns`: reason, post (`excerpt(r.posts?.content, 80) || 'Post no longer available'`), submitted, status. `isOpen = r => r.status === 'pending'`. `cap={TRUST_CAPS.reports}`. Drawer body: `<dl>` Reason, Reported, then `<div className="adm-drawer-text">{r.posts?.content || 'Post no longer available'}</div>`. Footer when pending: `Delete post` (only if `r.post_id && r.posts`), `askConfirm({ title: 'Delete this post?', consequence: 'This permanently deletes the post along with its likes and comments. This cannot be undone.', confirmLabel: 'Delete post', action: async () => finish(await actions.deletePost(r.post_id)) })`; and `Dismiss` calling `actions.resolveReport(r.id)` then `finish`. The consequence text is the one `deletePost` uses today. `excerpt(s, n)` is a local helper: `s && s.length > n ? s.slice(0, n) + '…' : s`.

- [ ] **Step 4: Run, expect PASS.** Commit `feat(carefind): Reports section on the review queue`.

---

### Task 10: Moderation bulk logic and ModerationSection

**Files:**
- Modify: `ADM/lib/bulkModeration.js`, `ADM/lib/bulkModeration.test.js`
- Create: `ADM/sections/ModerationSection.jsx`, `ADM/sections/ModerationSection.test.jsx`

**Interfaces:**
- Produces in `lib/bulkModeration.js`: `runBulk(action, items, { reports, call, audit })` resolving `{ done, skipped: [{ id, title, why }], failed: [{ id, title, why }] }`, where `action` is `'approve_verifications' | 'reject_verifications' | 'dismiss_reports' | 'delete_posts'`, `call(name, payload)` is `callAdminAuth`, `audit(action, type, id, meta)` never throws; and `summarizeBulk(result, verb)` resolving `{ message, type }` with `type` of `'success' | 'warning' | 'error'`.

- [ ] **Step 1: Failing tests** appended to `bulkModeration.test.js`

```js
import { vi } from 'vitest'
import { runBulk, summarizeBulk } from './bulkModeration'

const ver = { id: 'v1', source: 'verification', title: 'Verification: Amina', target_id: 'u1', raw: { profession: 'Pharmacist' } }
const rep = { id: 'p1', source: 'report', title: 'spam', target_id: 'p1', raw: { id: 'r1', post_id: 'p1', status: 'pending' } }
const post = { id: 'p9', source: 'post', title: 'Flagged post', target_id: 'p9', raw: {} }
const deps = (over = {}) => ({ reports: [{ id: 'r1', post_id: 'p1', status: 'pending' }, { id: 'r2', post_id: 'p1', status: 'pending' }], call: vi.fn().mockResolvedValue({}), audit: vi.fn(), ...over })

describe('runBulk', () => {
  it('approves verifications only and names what it skipped', async () => {
    const d = deps()
    const res = await runBulk('approve_verifications', [ver, rep], d)
    expect(d.call).toHaveBeenCalledWith('approve_verification', { id: 'v1', userId: 'u1', profession: 'Pharmacist' })
    expect(res.done).toBe(1)
    expect(res.skipped).toEqual([{ id: 'p1', title: 'spam', why: 'not a verification' }])
  })

  it('dismisses every pending report on a post by report id', async () => {
    const d = deps()
    const res = await runBulk('dismiss_reports', [rep], d)
    expect(d.call).toHaveBeenCalledWith('resolve_report', { id: 'r1' })
    expect(d.call).toHaveBeenCalledWith('resolve_report', { id: 'r2' })
    expect(d.call).not.toHaveBeenCalledWith('resolve_report', { id: 'p1' })
    expect(res.done).toBe(1)
  })

  it('skips a report with nothing left to dismiss', async () => {
    const res = await runBulk('dismiss_reports', [rep], deps({ reports: [{ id: 'r1', post_id: 'p1', status: 'resolved' }] }))
    expect(res.done).toBe(0)
    expect(res.skipped[0].why).toBe('nothing left to dismiss')
  })

  it('deletes the post behind a report or a flagged post, by post id', async () => {
    const d = deps()
    const res = await runBulk('delete_posts', [rep, post, ver], d)
    expect(d.call).toHaveBeenCalledWith('delete_post', { id: 'p1' })
    expect(d.call).toHaveBeenCalledWith('delete_post', { id: 'p9' })
    expect(res.done).toBe(2)
    expect(res.skipped).toHaveLength(1)
  })

  it('records a failed item with its reason and carries on', async () => {
    const d = deps({ call: vi.fn().mockRejectedValueOnce(new Error('Not allowed')).mockResolvedValue({}) })
    const res = await runBulk('reject_verifications', [ver, { ...ver, id: 'v2', title: 'Verification: Bola' }], d)
    expect(res.failed).toEqual([{ id: 'v1', title: 'Verification: Amina', why: 'Not allowed' }])
    expect(res.done).toBe(1)
  })

  it('an audit failure does not fail the item', async () => {
    const d = deps({ audit: vi.fn().mockRejectedValue(new Error('down')) })
    const res = await runBulk('approve_verifications', [ver], d)
    expect(res.done).toBe(1)
    expect(res.failed).toEqual([])
  })
})

describe('summarizeBulk', () => {
  it('is a success when everything worked', () => {
    expect(summarizeBulk({ done: 3, skipped: [], failed: [] }, 'Approved')).toEqual({ message: 'Approved 3', type: 'success' })
  })
  it('names skipped and failed items, failures win the type', () => {
    const out = summarizeBulk({ done: 1, skipped: [{ id: 'a', title: 'A', why: 'not a verification' }], failed: [{ id: 'b', title: 'B', why: 'Not allowed' }] }, 'Approved')
    expect(out.type).toBe('error')
    expect(out.message).toBe('Approved 1. Skipped: A (not a verification). Failed: B (Not allowed)')
  })
  it('is a warning when only skips happened', () => {
    expect(summarizeBulk({ done: 0, skipped: [{ id: 'a', title: 'A', why: 'x' }], failed: [] }, 'Dismissed').type).toBe('warning')
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (append to `bulkModeration.js`)

```js
const note = (list, item, why) => list.push({ id: item.id, title: item.title, why })

// Run one bulk action over Moderation items. Each item is handled by its real
// type with the right id; anything that does not fit the action is skipped and
// named, and a failure on one item never stops the rest.
export async function runBulk(action, items, { reports = [], call, audit }) {
  const result = { done: 0, skipped: [], failed: [] }
  const safeAudit = async (...args) => { try { await audit(...args) } catch { /* never blocks moderation */ } }

  for (const item of items) {
    try {
      if (action === 'approve_verifications' || action === 'reject_verifications') {
        if (item.source !== 'verification') { note(result.skipped, item, 'not a verification'); continue }
        if (action === 'approve_verifications') {
          await call('approve_verification', { id: item.id, userId: item.target_id, profession: item.raw?.profession })
          await safeAudit('approve', 'verification', item.id, { userId: item.target_id })
        } else {
          await call('reject_verification', { id: item.id })
          await safeAudit('reject', 'verification', item.id, {})
        }
      } else if (action === 'dismiss_reports') {
        if (item.source !== 'report') { note(result.skipped, item, 'not a report'); continue }
        const toResolve = reportsToResolve(item, reports)
        if (toResolve.length === 0) { note(result.skipped, item, 'nothing left to dismiss'); continue }
        for (const rep of toResolve) {
          await call('resolve_report', { id: rep.id })
          await safeAudit('resolve', 'report', rep.id, {})
        }
      } else if (action === 'delete_posts') {
        if (item.source !== 'report' && item.source !== 'post') { note(result.skipped, item, 'not a post'); continue }
        await call('delete_post', { id: item.target_id })
        await safeAudit('delete', 'post', item.target_id, { reason: item.source === 'report' ? 'reported content' : 'flagged content' })
      } else {
        throw new Error(`Unknown bulk action ${action}`)
      }
      result.done++
    } catch (err) {
      note(result.failed, item, err.message)
    }
  }
  return result
}

export function summarizeBulk(result, verb) {
  const name = (x) => `${x.title || x.id} (${x.why})`
  let message = `${verb} ${result.done}`
  if (result.skipped.length) message += `. Skipped: ${result.skipped.map(name).join(', ')}`
  if (result.failed.length) message += `. Failed: ${result.failed.map(name).join(', ')}`
  const type = result.failed.length ? 'error' : result.skipped.length ? 'warning' : 'success'
  return { message, type }
}
```

- [ ] **Step 4: Run, expect PASS** (4 + 9 tests).

- [ ] **Step 5: ModerationSection test.** Mock `../hooks/useTrustQueues`, `../hooks/useReviewActions`, `../provider/AdminProvider.jsx` (`askConfirm`, `showToast`, `invalidateAdmin`), `../../../hooks/queries` (`useAdminData` returning `{ data: { posts: [] } }`), and `../adminApi` (`callAdminAuth`). Wrap in `ModerationProvider` from `../stores/moderationStore`. Tests:
  1. h1 "Moderation"; lists a report item, a flagged post item and a pending verification, each with a `PriorityBadge`.
  2. Source and priority filters narrow the list.
  3. Selecting a verification and a report row and pressing **Approve verifications** calls `approve_verification` once and shows a warning toast naming the skipped report.
  4. **Dismiss reports** calls `resolve_report` with the report ids, never the post id.
  5. **Delete posts** asks `askConfirm` first; `delete_post` runs with the post id only after the confirm `action` runs.
  6. Row checkboxes are `input[type=checkbox]` with accessible names; Select all selects the filtered rows.
  7. Review opens the drawer: a report item shows the same body as the Reports drawer (reason, post text); a verification shows applicant details.
  8. A failed `reports` or `verifications` source shows Retry rather than an empty queue (Moderation needs both loaded to list; if either failed show the banner "Couldn't load reports" / "Couldn't load verifications" and still list the other).

- [ ] **Step 6: Implement `ADM/sections/ModerationSection.jsx`.** Compose, do not copy: `useTrustQueues` for reports and verifications, `useAdminData(true).data?.posts` for flagged posts (the posts list cannot report a failure, which is Phase 1 finding 3; note it in a comment), `getModerationItems` from `../lib/priorityScoring`, `useModerationStore` for selection and filters, `DataTable` with columns priority (`PriorityBadge`), source, summary (`item.title`), age (`timeAgo`), a leading checkbox column (`<input type="checkbox" aria-label={`Select ${item.title}`} checked onChange>`), and a Review button per row opening `ReviewDrawer`. Drawer bodies reuse small exported body components: export `VerificationBody`/`ReportBody` from `VerificationsSection.jsx`/`ReportsSection.jsx` (extract from Tasks 7 and 9 so there is one definition). `BulkActionBar` with `approveLabel="Approve verifications" rejectLabel="Reject verifications" dismissLabel="Dismiss reports" deleteLabel="Delete posts"`; each handler calls `runBulk(...)`, then `summarizeBulk(...)`, `showToast(message, { type })`, `clearSelection()`, `invalidateAdmin()`. Delete goes through `askConfirm` first. Selection and filters live in `ModerationProvider`, which `AdminPanel` mounts (Task 11).

- [ ] **Step 7: Run, expect PASS.** Commit `feat(carefind): Moderation section with bulk actions that name what they skipped`.

---

### Task 11: Wire the sections and retire the legacy code

**Files:**
- Modify: `ADM/AdminPanel.jsx`, `ADM/legacy/LegacyTabHost.jsx`
- Delete: `ADM/tabs/VerificationsTab.jsx`, `ADM/tabs/ClaimsTab.jsx`, `ADM/tabs/ReportsTab.jsx`, `ADM/tabs/ModerationQueue.jsx`
- Modify tests that import them, if any (`grep -rn "VerificationsTab\|ClaimsTab\|ReportsTab\|ModerationQueue" apps/carefind/src`).

- [ ] **Step 1: AdminPanel.** Import the four sections and `ModerationProvider` from `./stores/moderationStore`. In `ActiveSection` add before the legacy fallback:

```jsx
  if (tab === 'verifications') return <VerificationsSection />
  if (tab === 'claims') return <ClaimsSection />
  if (tab === 'reports') return <ReportsSection />
  if (tab === 'moderation') return <ModerationSection />
```

Wrap the tree in `ModerationProvider` inside `AdminProvider` (so Moderation's store is mounted for the section; `LegacyTabHost` keeps its own wrapper for the tabs still using the store, and is removed with them in Phase 5).

- [ ] **Step 2: LegacyTabHost.** Delete: the four tab imports; the four render lines; `credentialLoadingId` and `credentialError` state; `openCredential`, `approveVerif`, `rejectVerif`, `approveClaim`, `rejectClaim`, `resolveReport`. **Keep `deletePost`**: PostsTab still uses it. Remove any now-unused imports.

- [ ] **Step 3: Delete the four old tab files.** Run the grep above and fix any remaining import.

- [ ] **Step 4: Scan for un-imported JSX components** in the four sections and `AdminPanel.jsx` (ESLint cannot catch it): every `<Name` has an import.

- [ ] **Step 5: Verify.** `cd apps/carefind && npx vitest run src/modules/admin` all green; the pre-existing `AdminPanel` tests that clicked these tabs still pass (update only selectors that depended on the old markup, and say so in the commit message).

- [ ] **Step 6: Commit** `refactor(carefind): Verification, Claims, Reports and Moderation leave the legacy host`.

---

### Task 12: Docs, full verification, PR

**Files:**
- Modify: `docs/ADMIN_REDESIGN.md`

- [ ] **Step 1: Docs.** Phase table: Phase 1 "built (PR #22)", Phase 2a "built on `feat/carefind-admin-phase2a`", Phase 2b "not started" (Users, Businesses). Code layout: add `ui/ReviewQueue`, `ui/ReviewDrawer`, `hooks/useTrustQueues`, `hooks/useReviewActions`, `lib/bulkModeration`. Findings:
  - `16.` Moderation items for reports are keyed by post id; bulk actions sent that to `resolve_report`. Fixed (Task 1) and every pending report on the post is now resolved.
  - `17.` Moderation "Reject" on a report called `resolve_report`, same as Approve. Fixed (Task 2): bulk actions act only on the types their labels name and say what they skipped.
  - `18.` Moderation's posts source still comes from `useAdminData`, which turns a failed fetch into an empty list (finding 3); the flagged-post part of the queue cannot show a load failure until `useAdminData` is replaced.
  - `19.` The drawer is 500px wide at most; at phone width it fills the screen. A wider review drawer would need a width option in the shared `Modal`, which this phase does not change.

- [ ] **Step 2: Full verification** from `apps/carefind`: `npx vitest run` (expect 0 failures; report the file and test counts), `npm run build` (succeeds), `npm run lint` (0 errors).

- [ ] **Step 3: Commit** `docs(carefind): Phase 2a state and findings 16-19`.

- [ ] **Step 4: PR.** Only when the user approves. Push with the AbdullahiTama `gh` login, open the PR against `main` as a draft stating it waits on PR #22 and that responsive widths 375/390/768/1024/1440/1920 are unmeasured; body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review

- **Spec coverage:** units (ReviewDrawer T5, ReviewQueue T6, useTrustQueues T3, useReviewActions T4, four sections T7-T10), per-screen columns/drawers/actions (T7-T10), bulk behaviour and labels (T2, T10), states (T6), findings 16 and 17 (T1, T2, T12), docs (T12), removal from legacy (T11). Findings 18 and 19 are new, recorded in T12.
- **Deviation from the spec, called out:** the spec said the hook reads "through the existing repositories"; the real sources are the three `callAdminAuth` list actions, read per source with their own status (same endpoints `useOverviewData` uses). `useAdminData` swallows failures, so using it would break the "failed is never empty" rule. Moderation's flagged posts still come from `useAdminData` (finding 18).
- **Deviation 2:** the spec says "full-screen under 768px"; the shared `Modal` drawer is `width: 100%, maxWidth 500`, so it is full width up to 500px and 500px wide above. Finding 19 states this; the shared package is not changed.
- **Known thinness:** Task 10's `ModerationSection` test and implementation are given as eight exact cases and a composition recipe, not full code, because the section reuses the drawer bodies extracted in Tasks 7 and 9. The implementer writes them out in the Task 7 test pattern; a reviewer should check this task most closely.
- **Type consistency:** `useReviewActions` method names and argument shapes match their use in T7-T10; `runBulk` action names match the BulkActionBar handlers; `TRUST_CAPS.reports` is used in T9.
