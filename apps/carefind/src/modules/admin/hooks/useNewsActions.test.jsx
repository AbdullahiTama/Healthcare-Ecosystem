import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const callAdminAuth = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn(), recordAction: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useNewsActions } from './useNewsActions'

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  Object.values(admin).forEach(f => { f.mockReset() })
})

describe('useNewsActions', () => {
  it('approves with the edited fields when edited', async () => {
    const { result } = renderHook(() => useNewsActions())
    const out = await run(() => result.current.approveNews({ id: 'n1', headline: 'H', subtitle: 'S', body: 'B', edited: true, originalHeadline: 'Original' }))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('approve_news', { id: 'n1', edits: { headline: 'H', subtitle: 'S', body: 'B' } })
    // As legacy, the audit records the item's original headline, not the edit.
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', { auditAction: 'approve', targetType: 'news', targetId: 'n1', metadata: { headline: 'Original' } })
    expect(admin.recordAction).toHaveBeenCalledWith({ action: 'approve', target: 'news', id: 'n1', timestamp: expect.any(String) })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('News item approved', { type: 'success' })
  })

  it('approves with empty edits when not edited', async () => {
    const { result } = renderHook(() => useNewsActions())
    await run(() => result.current.approveNews({ id: 'n1', headline: 'H', subtitle: 'S', body: 'B', edited: false }))
    expect(callAdminAuth).toHaveBeenCalledWith('approve_news', { id: 'n1', edits: {} })
    // Without originalHeadline the audit falls back to the headline sent.
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', { auditAction: 'approve', targetType: 'news', targetId: 'n1', metadata: { headline: 'H' } })
  })

  it('rejects, audits and records the action', async () => {
    const { result } = renderHook(() => useNewsActions())
    const out = await run(() => result.current.rejectNews('n2'))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('reject_news', { id: 'n2' })
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', { auditAction: 'reject', targetType: 'news', targetId: 'n2', metadata: {} })
    expect(admin.recordAction).toHaveBeenCalledWith({ action: 'reject', target: 'news', id: 'n2', timestamp: expect.any(String) })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('News item rejected', { type: 'success' })
  })

  it('deletes and audits without recording an action', async () => {
    const { result } = renderHook(() => useNewsActions())
    const out = await run(() => result.current.deleteNews('n3'))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('delete_news', { id: 'n3' })
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', { auditAction: 'delete', targetType: 'news', targetId: 'n3', metadata: {} })
    expect(admin.recordAction).not.toHaveBeenCalled()
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('News item deleted', { type: 'success' })
  })

  it.each([
    ['approveNews', { id: 'n1', headline: 'H', subtitle: 'S', body: 'B', edited: true }],
    ['rejectNews', 'n1'],
    ['deleteNews', 'n1'],
  ])('%s returns the error and neither toasts, refreshes nor audits on failure', async (name, arg) => {
    callAdminAuth.mockRejectedValueOnce(new Error('Not allowed'))
    const { result } = renderHook(() => useNewsActions())
    const out = await run(() => result.current[name](arg))
    expect(out).toEqual({ ok: false, error: 'Not allowed' })
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(admin.recordAction).not.toHaveBeenCalled()
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
  })

  it('a failing audit write does not fail the action', async () => {
    callAdminAuth.mockImplementation(async (a) => { if (a === 'log_audit_action') throw new Error('audit down'); return {} })
    const { result } = renderHook(() => useNewsActions())
    const out = await run(() => result.current.rejectNews('n1'))
    expect(out).toEqual({ ok: true })
    expect(admin.showToast).toHaveBeenCalledWith('News item rejected', { type: 'success' })
  })

  it('a throwing refresh after success still resolves ok', async () => {
    admin.invalidateAdmin.mockImplementation(() => { throw new Error('refresh broke') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useNewsActions())
    const out = await run(() => result.current.deleteNews('n1'))
    expect(out).toEqual({ ok: true })
    expect(admin.showToast).toHaveBeenCalledWith('News item deleted', { type: 'success' })
    spy.mockRestore()
  })

  it('busyId is the id being acted on and clears afterwards', async () => {
    let release
    callAdminAuth.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useNewsActions())
    expect(result.current.busyId).toBeNull()
    let pending
    act(() => { pending = result.current.rejectNews('n9') })
    expect(result.current.busyId).toBe('n9')
    await act(async () => { release({}); await pending })
    expect(result.current.busyId).toBeNull()
  })
})
