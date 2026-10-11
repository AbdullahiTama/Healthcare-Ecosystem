import { describe, it, expect, vi } from 'vitest'

// CareFind's binding of the shared withdrawal recovery: Paystack lookup + trust/email effects. The decision and
// settlement logic itself is tested in shared-payments; the refund is the database's settle_withdrawal.
const h = vi.hoisted(() => ({ paystackFetch: vi.fn(), applied: [], inFlight: [] }))
vi.mock('../paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../withdrawalEffects.js', () => ({
  applyWithdrawalResult: async (_s, outcome, result) => { h.applied.push([outcome, result]) },
  applyWithdrawalInFlight: async (_s, row) => { h.inFlight.push(row.id) },
}))

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
  it('no transfer call was ever made (reserved) and Paystack has never heard of it: refunds through settle_withdrawal by request id', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    expect(await reconcileWithdrawal(s, row({ status: 'reserved' }))).toMatchObject({ outcome: 'refunded' })
    expect(s.rpcCalls[0]).toEqual(['settle_withdrawal', expect.objectContaining({ p_outcome: 'failed', p_request_id: 'w1' })])
  })

  it('a transfer call WAS made, no code came back, and Paystack has no record: it waits the full hour before believing it', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    // marked 30 minutes ago (row() default): nothing is written
    expect(await reconcileWithdrawal(s, row())).toMatchObject({ outcome: 'waiting' })
    expect(s.rpcCalls).toHaveLength(0)
    // marked two hours ago: now it is released, by exact id
    const marked = new Date(NOW - 2 * 3_600_000).toISOString()
    expect(await reconcileWithdrawal(s, row({ updated_at: marked }))).toMatchObject({ outcome: 'refunded' })
    expect(s.rpcCalls[0][1]).toMatchObject({ p_outcome: 'failed', p_request_id: 'w1' })
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
    const fresh = new Date().toISOString()
    // a DEFINITE refusal is confirmed-not-sent; the same fresh row without that confirmation waits
    expect((await reconcileWithdrawal(s, row({ created_at: fresh, updated_at: fresh }), { graceMs: 0, confirmedNotSent: true })).outcome).toBe('refunded')
    expect((await reconcileWithdrawal(s, row({ created_at: fresh, updated_at: fresh }))).outcome).toBe('waiting')
    // a timeout that is merely checked at once (graceMs 0, not confirmed) still waits
    expect((await reconcileWithdrawal(s, row({ created_at: fresh, updated_at: fresh }), { graceMs: 0 })).outcome).toBe('waiting')
  })
})

describe('sweepWithdrawals (CareFind)', () => {
  it('applies trust/email effects only for the changes this sweep made', async () => {
    h.applied.length = 0
    h.paystackFetch.mockImplementation(async (path) => (path.includes('cf_wd_ok')
      ? { status: true, data: { status: 'success' } }
      : path.includes('cf_wd_gone') ? { status: false, message: 'Transfer not found' } : { status: true, data: { status: 'success' } }))
    const rows = [row({ id: 'a', paystack_reference: 'cf_wd_ok', paystack_transfer_code: 'T' }), row({ id: 'b', status: 'reserved', paystack_reference: 'cf_wd_gone' }), row({ id: 'c', paystack_reference: 'cf_wd_late', paystack_transfer_code: 'T' })]
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

describe('sweepWithdrawals (CareFind): the slow-transfer notice', () => {
  it('a transfer Paystack still reports as pending/otp/processing past the grace period is announced once per sweep and never settled', async () => {
    h.inFlight.length = 0
    h.applied.length = 0
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'pending' } })
    const s = fakeSupabase([row({ id: 'p1', paystack_reference: 'cf_wd_p1', paystack_transfer_code: 'T' })], () => ({ result: 'x' }))
    const out = await sweepWithdrawals(s, { now: NOW })
    expect(h.inFlight).toEqual(['p1'])
    expect(h.applied).toEqual([])
    expect(s.rpcCalls).toHaveLength(0)
    expect(out).toMatchObject({ checked: 1, waiting: 1, refunded: 0, completed: 0, inFlight: 1 })
  })
})
