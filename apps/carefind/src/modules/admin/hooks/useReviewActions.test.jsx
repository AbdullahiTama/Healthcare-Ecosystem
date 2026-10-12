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
