import { describe, it, expect, vi } from 'vitest'

// CareHub's binding of the shared withdrawal recovery (Paystack lookup). The decision and settlement logic is tested
// in shared-payments; the refund is the database's settle_business_withdrawal.
const h = vi.hoisted(() => ({ paystackFetch: vi.fn() }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))

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
  it('Paystack never created the transfer: refunds through settle_business_withdrawal by request id', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    expect(await reconcileBusinessWithdrawal(s, row())).toMatchObject({ outcome: 'refunded' })
    expect(s.rpcCalls[0]).toEqual(['settle_business_withdrawal', expect.objectContaining({ p_outcome: 'failed', p_request_id: 'bw1' })])
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
    expect((await reconcileBusinessWithdrawal(fakeSupabase([], () => ({ result: 'already_refunded' })), row())).outcome).toBe('waiting')
  })

  it('graceMs: 0 lets a fresh row be checked immediately', async () => {
    h.paystackFetch.mockResolvedValue({ status: false, message: 'Transfer not found' })
    const s = fakeSupabase([], () => ({ result: 'refunded' }))
    expect((await reconcileBusinessWithdrawal(s, row({ created_at: new Date().toISOString() }), { graceMs: 0 })).outcome).toBe('refunded')
    expect((await reconcileBusinessWithdrawal(s, row({ created_at: new Date().toISOString() }))).outcome).toBe('waiting')
  })
})

describe('reconcileBusinessWithdrawals (the cron sweep)', () => {
  it('settles each stuck request and counts outcomes', async () => {
    h.paystackFetch.mockImplementation(async (path) => (path.includes('gone') ? { status: false, message: 'Transfer not found' } : { status: true, data: { status: 'success' } }))
    const rows = [row({ id: 'a', paystack_reference: 'ch_wd_ok', paystack_transfer_code: 'T' }), row({ id: 'b', paystack_reference: 'ch_wd_gone' })]
    const s = fakeSupabase(rows, (a) => ({ result: a.p_outcome === 'success' ? 'completed' : 'refunded' }))
    const out = await reconcileBusinessWithdrawals(s, { now: NOW, logger: { warn() {}, error() {} } })
    expect(out).toEqual({ checked: 2, refunded: 1, completed: 1, waiting: 0, errors: 0 })
  })

  it('a query failure throws instead of reporting success', async () => {
    const s = { rpc: async () => ({}), from: () => { const b = { select: () => b, in: () => b, not: () => b, lt: () => b, order: () => b, limit: async () => ({ data: null, error: { message: 'db down' } }) }; return b } }
    await expect(reconcileBusinessWithdrawals(s)).rejects.toThrow('db down')
  })

  it('exports the same grace period as the shared module', () => {
    expect(IN_FLIGHT_GRACE_MS).toBe(10 * 60 * 1000)
  })
})
