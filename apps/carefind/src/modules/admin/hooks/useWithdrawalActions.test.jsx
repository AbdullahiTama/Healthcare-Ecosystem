import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const callAdminAuth = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn(), recordAction: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useWithdrawalActions } from './useWithdrawalActions'

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  Object.values(admin).forEach(f => { f.mockReset() })
})

describe('useWithdrawalActions', () => {
  it('rejects with exactly { id }, refreshes and toasts', async () => {
    const { result } = renderHook(() => useWithdrawalActions())
    const out = await run(() => result.current.rejectWithdrawal('w1'))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('reject_withdrawal', { id: 'w1' })
    expect(admin.invalidateAdmin).toHaveBeenCalled()
    expect(admin.showToast).toHaveBeenCalledWith('Withdrawal rejected', { type: 'success' })
  })

  it('makes exactly one server call and writes no audit or action history, as the legacy handler did', async () => {
    const { result } = renderHook(() => useWithdrawalActions())
    await run(() => result.current.rejectWithdrawal('w1'))
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
    expect(admin.recordAction).not.toHaveBeenCalled()
  })

  it('on a server error returns it, still refreshes (the request may have changed) and does not toast', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('Already confirmed paid'))
    const { result } = renderHook(() => useWithdrawalActions())
    const out = await run(() => result.current.rejectWithdrawal('w1'))
    expect(out).toEqual({ ok: false, error: 'Already confirmed paid' })
    expect(admin.invalidateAdmin).toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  // The server committed (a refund, or recorded as paid): a refresh or toast that
  // throws afterwards must not turn that into a reported failure.
  it('still resolves { ok: true } when the refresh throws after the server succeeded', async () => {
    admin.invalidateAdmin.mockImplementation(() => { throw new Error('refresh broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useWithdrawalActions())
    const out = await run(() => result.current.rejectWithdrawal('w1'))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
    expect(result.current.busy).toBeNull()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed after the server call'), expect.stringMatching(/broke/))
    logged.mockRestore()
  })

  it('still resolves { ok: true } when the toast throws after the server succeeded', async () => {
    admin.showToast.mockImplementation(() => { throw new Error('toast broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useWithdrawalActions())
    const out = await run(() => result.current.rejectWithdrawal('w1'))
    expect(out).toEqual({ ok: true })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed after the server call'), expect.stringMatching(/broke/))
    logged.mockRestore()
  })

  it('on a server error still returns that error when the refresh throws', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('Already confirmed paid'))
    admin.invalidateAdmin.mockImplementation(() => { throw new Error('refresh broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useWithdrawalActions())
    const out = await run(() => result.current.rejectWithdrawal('w1'))
    expect(out).toEqual({ ok: false, error: 'Already confirmed paid' })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed after the server call'), expect.stringMatching(/broke/))
    logged.mockRestore()
  })

  it('busy is the id being rejected and clears afterwards', async () => {
    let release
    callAdminAuth.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useWithdrawalActions())
    let pending
    act(() => { pending = result.current.rejectWithdrawal('w9') })
    expect(result.current.busy).toBe('w9')
    await act(async () => { release({}); await pending })
    expect(result.current.busy).toBeNull()
  })
})
