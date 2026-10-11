import { describe, it, expect, vi } from 'vitest'

// CareHub's binding of the shared withdrawal recovery (Paystack lookup). The decision and settlement logic is tested
// in shared-payments; the refund is the database's settle_business_withdrawal.
const h = vi.hoisted(() => ({ paystackFetch: vi.fn(), applied: [] }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../_lib/businessWithdrawalEffects.js', () => ({ applyBusinessWithdrawalResult: async (_s, result) => { h.applied.push(result) } }))

import { reconcileBusinessWithdrawal, reconcileBusinessWithdrawals, IN_FLIGHT_GRACE_MS } from '../_lib/withdrawalRecovery.js'

const NOW = Date.now()
const old = new Date(NOW - 30 * 60 * 1000).toISOString()
const row = (over = {}) => ({ id: 'bw1', business_id: 'biz', amount: 500000, status: 'processing', paystack_reference: 'ch_wd_1', paystack_transfer_code: null, created_at: old, ...over })

const fakeSupabase = (rows, settle) => {
  const rpcCalls = []
  return {
    rpcCalls,
    rpc: async (name, args) => { rpcCalls.push([name, args]); return { data: settle(args), error: null } },
    from: (table) => {
      const b = { select: () => b, in: () => b, not: () => b, lt: () => b, order: () => b, limit: async () => ({ data: rows, error: null, table }) }
      return b
    },
  }
}

describe('reconcileBusinessWithdrawal', () => {
  it('no transfer call was ever made (reserved) and Paystack has never heard of it: refunds through settle_business_withdrawal by request id', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    expect(await reconcileBusinessWithdrawal(s, row({ status: 'reserved' }))).toMatchObject({ outcome: 'refunded' })
    expect(s.rpcCalls[0]).toEqual(['settle_business_withdrawal', expect.objectContaining({ p_outcome: 'failed', p_request_id: 'bw1' })])
  })

  it('a transfer call WAS made, no code came back, Paystack has no record: waits the full hour from the mark before believing it', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    expect(await reconcileBusinessWithdrawal(s, row())).toMatchObject({ outcome: 'waiting' }) // marked 30 minutes ago
    expect(s.rpcCalls).toHaveLength(0)
    const marked = new Date(NOW - 2 * 3_600_000).toISOString()
    expect(await reconcileBusinessWithdrawal(s, row({ updated_at: marked }))).toMatchObject({ outcome: 'refunded' })
  })

  it('transfer succeeded: completes, never refunds', async () => {
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'success' } })
    const s = fakeSupabase([], () => ({ result: 'completed' }))
    expect((await reconcileBusinessWithdrawal(s, row({ paystack_transfer_code: 'T' }))).outcome).toBe('completed')
    expect(s.rpcCalls.every(([, a]) => a.p_outcome === 'success')).toBe(true)
  })

  it('still in flight: waits and touches nothing; already settled elsewhere: waits (so effects cannot run twice)', async () => {
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'processing' } })
    const s = fakeSupabase([], () => ({ result: 'x' }))
    expect((await reconcileBusinessWithdrawal(s, row({ paystack_transfer_code: 'T' }))).outcome).toBe('waiting')
    expect(s.rpcCalls).toHaveLength(0)
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    expect((await reconcileBusinessWithdrawal(fakeSupabase([], () => ({ result: 'already_refunded' })), row({ status: 'reserved' }))).outcome).toBe('waiting')
  })

  it('graceMs: 0 lets a fresh row be checked immediately', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    const fresh = new Date().toISOString()
    // a DEFINITE refusal (confirmedNotSent) is released at once; the same fresh row without it, or a merely-immediate check, waits
    expect((await reconcileBusinessWithdrawal(s, row({ created_at: fresh, updated_at: fresh }), { graceMs: 0, confirmedNotSent: true })).outcome).toBe('refunded')
    expect((await reconcileBusinessWithdrawal(s, row({ created_at: fresh, updated_at: fresh }))).outcome).toBe('waiting')
    expect((await reconcileBusinessWithdrawal(s, row({ created_at: fresh, updated_at: fresh }), { graceMs: 0 })).outcome).toBe('waiting')
  })
})

describe('reconcileBusinessWithdrawals (the cron sweep)', () => {
  it('settles each stuck request, counts outcomes, and emails the owner only for the changes this sweep made', async () => {
    h.applied.length = 0
    h.paystackFetch.mockImplementation(async (path) => (path.includes('gone') ? { status: false, message: 'Transfer not found' } : { status: true, data: { status: 'success' } }))
    const rows = [row({ id: 'a', paystack_reference: 'ch_wd_ok', paystack_transfer_code: 'T' }), row({ id: 'b', status: 'reserved', paystack_reference: 'ch_wd_gone' }), row({ id: 'c', paystack_reference: 'ch_wd_late', paystack_transfer_code: 'T' })]
    const s = fakeSupabase(rows, (a) => ({ id: a.p_request_id, result: a.p_request_id === 'c' ? 'already_completed' : a.p_outcome === 'success' ? 'completed' : 'refunded', reference: 'ch_wd_late' }))
    const out = await reconcileBusinessWithdrawals(s, { now: NOW, logger: { warn() {}, error() {} } })
    expect(out).toEqual({ checked: 3, refunded: 1, completed: 1, waiting: 1, errors: 0 })
    expect(h.applied.map((r) => [r.result, r.id])).toEqual([['completed', 'a'], ['refunded', 'b']])
  })

  it('a query failure throws instead of reporting success', async () => {
    const s = { rpc: async () => ({}), from: () => { const b = { select: () => b, in: () => b, not: () => b, lt: () => b, order: () => b, limit: async () => ({ data: null, error: { message: 'db down' } }) }; return b } }
    await expect(reconcileBusinessWithdrawals(s)).rejects.toThrow('db down')
  })

  it('exports the same grace period as the shared module', () => {
    expect(IN_FLIGHT_GRACE_MS).toBe(10 * 60 * 1000)
  })
})

describe('reconcileBusinessWithdrawals: the slow-transfer notice', () => {
  it('a transfer Paystack still reports as in flight past the grace period is announced as in_flight (never settled)', async () => {
    h.applied.length = 0
    h.paystackFetch.mockResolvedValue({ status: true, data: { status: 'otp' } })
    const s = fakeSupabase([row({ id: 'p1', paystack_reference: 'ch_wd_p1', paystack_transfer_code: 'T' })], () => ({ result: 'x' }))
    const out = await reconcileBusinessWithdrawals(s, { now: NOW, logger: { warn() {}, error() {} } })
    expect(h.applied).toEqual([{ result: 'in_flight', id: 'p1', reference: 'ch_wd_p1' }])
    expect(s.rpcCalls).toHaveLength(0)
    expect(out).toMatchObject({ checked: 1, waiting: 1, inFlight: 1 })
  })
})
