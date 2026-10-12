import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useReconciliationFindings, useReconciliationActions } from './useReconciliation'

const ALLOWED = ['admin_list_reconciliation', 'admin_update_reconciliation_finding', 'admin_run_reconciliation']
const seen = new Set()
const wrapper = ({ children }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
// Every mock goes through here so the set of called actions is recorded.
const respond = (impl) => callAdminAuth.mockImplementation((action, payload) => { seen.add(action); return impl(action, payload) })

beforeEach(() => {
  callAdminAuth.mockReset()
  respond(async () => ({}))
  Object.values(admin).forEach(f => { f.mockReset() })
})
afterAll(() => {
  // The hooks never reach for any action beyond the three money-check ones.
  expect(seen.size).toBeGreaterThan(0)
  for (const a of seen) expect(ALLOWED).toContain(a)
})

describe('useReconciliationFindings', () => {
  it('sends no filter for open and the status otherwise, and returns the array', async () => {
    respond(async () => ({ data: [{ id: 'f1' }] }))
    const open = renderHook(() => useReconciliationFindings('open'), { wrapper })
    await waitFor(() => expect(open.result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('admin_list_reconciliation', {})
    expect(open.result.current.data).toEqual([{ id: 'f1' }])

    const dismissed = renderHook(() => useReconciliationFindings('dismissed'), { wrapper })
    await waitFor(() => expect(dismissed.result.current.isSuccess).toBe(true))
    expect(callAdminAuth).toHaveBeenCalledWith('admin_list_reconciliation', { status: 'dismissed' })
  })

  it('rejects when the call fails', async () => {
    respond(async () => { throw new Error('down') })
    const { result } = renderHook(() => useReconciliationFindings('open'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('rejects when data is not an array, never an empty list', async () => {
    respond(async () => ({}))
    const { result } = renderHook(() => useReconciliationFindings('open'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })
})

describe('useReconciliationActions.updateFinding', () => {
  it('dismiss sends the note and toasts', async () => {
    const { result } = renderHook(() => useReconciliationActions())
    const out = await run(() => result.current.updateFinding({ id: 'f1', op: 'dismiss', note: 'Explained by refund' }))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'dismiss', note: 'Explained by refund' })
    expect(admin.invalidateAdmin).toHaveBeenCalled()
    expect(admin.showToast).toHaveBeenCalledWith('Finding dismissed', { type: 'success' })
  })

  it('acknowledge sends no note even if one is passed', async () => {
    const { result } = renderHook(() => useReconciliationActions())
    await run(() => result.current.updateFinding({ id: 'f1', op: 'acknowledge', note: 'ignored' }))
    expect(callAdminAuth).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'acknowledge', note: undefined })
    expect(admin.showToast).toHaveBeenCalledWith('Finding acknowledged', { type: 'success' })
  })

  it('reopen toasts that the finding was reopened', async () => {
    const { result } = renderHook(() => useReconciliationActions())
    await run(() => result.current.updateFinding({ id: 'f1', op: 'reopen' }))
    expect(callAdminAuth).toHaveBeenCalledWith('admin_update_reconciliation_finding', { id: 'f1', op: 'reopen', note: undefined })
    expect(admin.showToast).toHaveBeenCalledWith('Finding reopened', { type: 'success' })
  })

  it('returns the error and neither toasts nor refreshes on failure', async () => {
    respond(async () => { throw new Error('Not allowed') })
    const { result } = renderHook(() => useReconciliationActions())
    const out = await run(() => result.current.updateFinding({ id: 'f1', op: 'reopen' }))
    expect(out).toEqual({ ok: false, error: 'Not allowed' })
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })

  // The decision is recorded on the server: a refresh or toast that throws
  // afterwards must not turn it into a reported failure.
  it('still resolves { ok: true } for a dismiss when the refresh throws after the server succeeded', async () => {
    admin.invalidateAdmin.mockImplementation(() => { throw new Error('refresh broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useReconciliationActions())
    const out = await run(() => result.current.updateFinding({ id: 'f1', op: 'dismiss', note: 'Explained by refund' }))
    expect(out).toEqual({ ok: true })
    expect(result.current.busyId).toBeNull()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed after the server call'), expect.stringMatching(/broke/))
    logged.mockRestore()
  })

  it('still resolves { ok: true } when the toast throws after the server succeeded', async () => {
    admin.showToast.mockImplementation(() => { throw new Error('toast broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useReconciliationActions())
    const out = await run(() => result.current.updateFinding({ id: 'f1', op: 'acknowledge' }))
    expect(out).toEqual({ ok: true })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed after the server call'), expect.stringMatching(/broke/))
    logged.mockRestore()
  })

  it('busyId is the finding id while pending and null after', async () => {
    let release
    respond(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useReconciliationActions())
    let pending
    act(() => { pending = result.current.updateFinding({ id: 'f9', op: 'acknowledge' }) })
    expect(result.current.busyId).toBe('f9')
    await act(async () => { release({}); await pending })
    expect(result.current.busyId).toBeNull()
  })
})

describe('useReconciliationActions.runNow', () => {
  const runWith = async (response) => {
    respond(async () => response)
    const { result } = renderHook(() => useReconciliationActions())
    return run(() => result.current.runNow())
  }

  it('summarises the totals and refreshes', async () => {
    const out = await runWith({ report: { db: { totals: { open_critical: 2, open_warning: 3, open_info: 4 } } } })
    expect(out).toEqual({ ok: true, summary: 'Checked. 2 critical, 3 warning, 4 info open.' })
    expect(callAdminAuth).toHaveBeenCalledWith('admin_run_reconciliation')
    expect(admin.invalidateAdmin).toHaveBeenCalled()
  })

  it('still returns the summary when the refresh throws after the run succeeded, and does not toast a failure', async () => {
    admin.invalidateAdmin.mockImplementation(() => { throw new Error('refresh broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await runWith({ report: { db: { totals: { open_critical: 1, open_warning: 0, open_info: 0 } } } })
    expect(out).toEqual({ ok: true, summary: 'Checked. 1 critical, 0 warning, 0 info open.' })
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed after the server call'), expect.stringMatching(/broke/))
    logged.mockRestore()
  })

  it('says the run finished when there are no totals', async () => {
    const out = await runWith({ report: {} })
    expect(out).toEqual({ ok: true, summary: 'Run finished.' })
  })

  it('names the steps that failed', async () => {
    const out = await runWith({ report: { failed: ['a', 'b'] } })
    expect(out.summary).toBe('Run finished. Steps that failed: a, b.')
    const withTotals = await runWith({ report: { db: { totals: { open_critical: 0, open_warning: 1, open_info: 0 } }, failed: ['a', 'b'] } })
    expect(withTotals.summary).toBe('Checked. 0 critical, 1 warning, 0 info open. Steps that failed: a, b.')
  })

  it('toasts the error and clears running when the check cannot run', async () => {
    respond(async () => { throw new Error('timeout') })
    const { result } = renderHook(() => useReconciliationActions())
    const out = await run(() => result.current.runNow())
    expect(out).toEqual({ ok: false, error: 'timeout' })
    expect(admin.showToast).toHaveBeenCalledWith('The check could not run: timeout', { type: 'error' })
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(result.current.running).toBe(false)
  })

  it('running is true while pending', async () => {
    let release
    respond(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useReconciliationActions())
    let pending
    act(() => { pending = result.current.runNow() })
    expect(result.current.running).toBe(true)
    await act(async () => { release({ report: {} }); await pending })
    expect(result.current.running).toBe(false)
  })
})
