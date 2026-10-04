import { describe, it, expect, vi } from 'vitest'

// CareFind's binding of the shared withdrawal recovery: Paystack lookup + trust/email effects. The decision and
// settlement logic itself is tested in shared-payments; the refund is the database's settle_withdrawal.
const h = vi.hoisted(() => ({ paystackFetch: vi.fn(), applied: [] }))
vi.mock('../paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../withdrawalEffects.js', () => ({ applyWithdrawalResult: async (_s, outcome, result) => { h.applied.push([outcome, result]) } }))

import { reconcileWithdrawal, sweepWithdrawals } from '../withdrawalRecovery.js'

const NOW = Date.now()
const old = new Date(NOW - 30 * 60 * 1000).toISOString()
const row = (over = {}) => ({ id: 'w1', user_id: 'u1', amount: 10, status: 'processing', paystack_reference: 'cf_wd_1', paystack_transfer_code: null, created_at: old, ...over })

const fakeSupabase = (rows, settle) => {
  const rpcCalls = []
  return {
    rpcCalls,
    rpc: async (name, args) => { rpcCalls.push([name, args]); return { data: settle(args), error: null } },
    from: () => {
      const b = { select: () => b, in: () => b, not: () => b, lt: () => b, order: () => b, limit: async () => ({ data: rows, error: null }) }
      return b
    },
  }
}

describe('reconcileWithdrawal (CareFind)', () => {
  it('Paystack never created the transfer: refunds through settle_withdrawal by request id', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    expect(await reconcileWithdrawal(s, row())).toMatchObject({ outcome: 'refunded' })
    expect(s.rpcCalls[0]).toEqual(['settle_withdrawal', expect.objectContaining({ p_outcome: 'failed', p_request_id: 'w1' })])
  })

  it('transfer succeeded: completes, never refunds', async () => {
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'success' } })
    const s = fakeSupabase([], () => ({ result: 'completed' }))
    expect((await reconcileWithdrawal(s, row({ paystack_transfer_code: 'T' }))).outcome).toBe('completed')
    expect(s.rpcCalls.every(([, a]) => a.p_outcome === 'success')).toBe(true)
  })

  it('still in flight at Paystack: waits and touches nothing', async () => {
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'processing' } })
    const s = fakeSupabase([], () => ({ result: 'x' }))
    expect((await reconcileWithdrawal(s, row({ paystack_transfer_code: 'T' }))).outcome).toBe('waiting')
    expect(s.rpcCalls).toHaveLength(0)
  })

  it('graceMs: 0 lets a fresh row be checked immediately (right after an explicit Paystack rejection)', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    expect((await reconcileWithdrawal(s, row({ created_at: new Date().toISOString() }), { graceMs: 0 })).outcome).toBe('refunded')
    expect((await reconcileWithdrawal(s, row({ created_at: new Date().toISOString() }))).outcome).toBe('waiting')
  })
})

describe('sweepWithdrawals (CareFind)', () => {
  it('applies trust/email effects only for the changes this sweep made', async () => {
    h.applied.length = 0
    h.paystackFetch.mockImplementation(async (path) => (path.includes('cf_wd_ok')
      ? { status: true, data: { status: 'success' } }
      : path.includes('cf_wd_gone') ? { status: false, message: 'Transfer not found' } : { status: true, data: { status: 'success' } }))
    const rows = [row({ id: 'a', paystack_reference: 'cf_wd_ok', paystack_transfer_code: 'T' }), row({ id: 'b', paystack_reference: 'cf_wd_gone' }), row({ id: 'c', paystack_reference: 'cf_wd_late', paystack_transfer_code: 'T' })]
    const s = fakeSupabase(rows, (a) => (a.p_request_id === 'c' ? { result: 'already_completed' } : a.p_outcome === 'success' ? { result: 'completed', id: a.p_request_id } : { result: 'refunded', id: a.p_request_id }))
    const out = await sweepWithdrawals(s, { now: NOW })
    expect(out).toEqual({ checked: 3, refunded: 1, completed: 1, waiting: 1, errors: 0 })
    expect(h.applied.map(([o, r]) => [o, r.id])).toEqual([['success', 'a'], ['failed', 'b']])
  })

  it('a query failure throws instead of reporting success', async () => {
    const s = { rpc: async () => ({}), from: () => { const b = { select: () => b, in: () => b, not: () => b, lt: () => b, order: () => b, limit: async () => ({ data: null, error: { message: 'db down' } }) }; return b } }
    await expect(sweepWithdrawals(s)).rejects.toThrow('db down')
  })
})
