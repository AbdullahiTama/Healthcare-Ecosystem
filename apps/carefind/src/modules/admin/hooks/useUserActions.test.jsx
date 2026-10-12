import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const callAdminAuth = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn(), recordAction: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useUserActions } from './useUserActions'

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  Object.values(admin).forEach(f => { f.mockReset() })
})

describe('useUserActions', () => {
  it('verifies with the legacy payload and refreshes', async () => {
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.verifyUser({ id: 'u1', specialty: 'Pharmacist' }))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('manual_verify', { userId: 'u1', specialty: 'Pharmacist' })
    expect(admin.invalidateAdmin).toHaveBeenCalled()
    expect(admin.showToast).toHaveBeenCalledWith('User verified', { type: 'success' })
    // Manual verification writes no audit entry: exactly one server call.
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
    expect(admin.recordAction).not.toHaveBeenCalled()
  })

  it('refuses a blank specialty without calling the server', async () => {
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.verifyUser({ id: 'u1', specialty: '   ' }))
    expect(out).toEqual({ ok: false, error: 'Enter a specialty' })
    expect(callAdminAuth).not.toHaveBeenCalled()
  })

  it('suspends with the legacy payload, audits it and toasts that the user is marked as suspended', async () => {
    const { result } = renderHook(() => useUserActions())
    await run(() => result.current.suspendUser({ id: 'u1', days: '7' }))
    expect(callAdminAuth).toHaveBeenCalledWith('suspend_user', { userId: 'u1', days: '7' })
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({ auditAction: 'suspend', targetType: 'user', targetId: 'u1', metadata: { days: '7' } }))
    expect(admin.showToast).toHaveBeenCalledWith('User marked as suspended for 7 days', { type: 'success' })
    expect(admin.recordAction).not.toHaveBeenCalled()
  })

  it('deletes with the legacy payload and audits the name', async () => {
    const { result } = renderHook(() => useUserActions())
    await run(() => result.current.deleteUser({ id: 'u1', name: 'Ada Obi' }))
    expect(callAdminAuth).toHaveBeenCalledWith('delete_user', { userId: 'u1' })
    expect(callAdminAuth).toHaveBeenCalledWith('log_audit_action', expect.objectContaining({ auditAction: 'delete', targetType: 'user', targetId: 'u1', metadata: { name: 'Ada Obi' } }))
    expect(admin.showToast).toHaveBeenCalledWith('User deleted', { type: 'success' })
    expect(admin.recordAction).not.toHaveBeenCalled()
  })

  it('returns the error and neither toasts nor refreshes on failure', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('Not allowed'))
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.deleteUser({ id: 'u1', name: 'Ada' }))
    expect(out).toEqual({ ok: false, error: 'Not allowed' })
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('a failing audit write does not fail the action', async () => {
    callAdminAuth.mockImplementation(async (a) => { if (a === 'log_audit_action') throw new Error('audit down'); return {} })
    const { result } = renderHook(() => useUserActions())
    const out = await run(() => result.current.suspendUser({ id: 'u1', days: '1' }))
    expect(out.ok).toBe(true)
  })

  it('busy is the id being acted on and clears afterwards', async () => {
    let release
    callAdminAuth.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useUserActions())
    let pending
    act(() => { pending = result.current.deleteUser({ id: 'u9', name: 'X' }) })
    expect(result.current.busy).toBe('u9')
    await act(async () => { release({}); await pending })
    expect(result.current.busy).toBeNull()
  })
})
