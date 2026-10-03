import { describe, it, expect, vi } from 'vitest'
import { reconcileWithdrawal, sweepWithdrawals } from '../withdrawalRecovery.js'
import { IN_FLIGHT_GRACE_MS } from '../withdrawalAdmin.js'

vi.mock('../emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))

const NOW = Date.parse('2026-10-02T12:00:00Z')
const old = new Date(NOW - IN_FLIGHT_GRACE_MS - 60_000).toISOString()
const row = (extra = {}) => ({ id: 'w1', status: 'pending', paystack_reference: 'cf_wd_1', paystack_transfer_code: null, created_at: old, ...extra })

// `flipped` is what the guarded UPDATE ... .select('id') returns: one row when this call changed the
// status, none when another path (webhook, admin) had already settled it.
function client(rpcResult = { data: 'ok', error: null }, flipped = [{ id: 'w1' }]) {
  const updates = []
  const b = {
    update: (v) => { updates.push(v); return b },
    eq: () => b,
    select: async () => ({ data: flipped, error: null }),
  }
  return { client: { rpc: vi.fn(async () => rpcResult), from: () => b }, updates }
}
const opts = (status) => ({ getStatus: async () => status, now: NOW })

describe('reconcileWithdrawal', () => {
  it('Paystack never created the transfer: refunds through the atomic RPC', async () => {
    const { client: c } = client()
    expect(await reconcileWithdrawal(c, row(), opts('not_found'))).toEqual({ outcome: 'refunded' })
    expect(c.rpc).toHaveBeenCalledWith('reject_withdrawal_request', { p_request_id: 'w1' })
  })

  it('transfer failed or reversed: refunds', async () => {
    for (const s of ['failed', 'reversed']) {
      const { client: c } = client()
      expect((await reconcileWithdrawal(c, row({ paystack_transfer_code: 'T' }), opts(s))).outcome).toBe('refunded')
    }
  })

  it('transfer succeeded: completes, and does NOT refund', async () => {
    const { client: c, updates } = client()
    expect((await reconcileWithdrawal(c, row({ paystack_transfer_code: 'T' }), opts('success'))).outcome).toBe('completed')
    expect(updates).toEqual([{ status: 'completed' }])
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('succeeded but the webhook already completed it: waits, so the caller cannot record it twice', async () => {
    const { client: c } = client(undefined, [])
    expect(await reconcileWithdrawal(c, row({ paystack_transfer_code: 'T' }), opts('success'))).toEqual({ outcome: 'waiting', detail: 'already settled' })
  })

  it('transfer still in flight: waits, no refund, no completion', async () => {
    const { client: c, updates } = client()
    expect((await reconcileWithdrawal(c, row({ paystack_transfer_code: 'T' }), opts('pending'))).outcome).toBe('waiting')
    expect(c.rpc).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('refund RPC reports the row was already settled by another path: waits instead of double-refunding', async () => {
    const { client: c } = client({ data: 'already_completed', error: null })
    expect(await reconcileWithdrawal(c, row(), opts('not_found'))).toEqual({ outcome: 'waiting', detail: 'already_completed' })
  })

  it('refund RPC error: waits', async () => {
    const { client: c } = client({ data: null, error: { message: 'db' } })
    expect((await reconcileWithdrawal(c, row(), opts('failed'))).outcome).toBe('waiting')
  })

  it('graceMs: 0 lets a fresh row be checked immediately (used right after an explicit rejection)', async () => {
    const { client: c } = client()
    const fresh = row({ created_at: new Date(NOW - 1000).toISOString() })
    expect((await reconcileWithdrawal(c, fresh, { ...opts('not_found'), graceMs: 0 })).outcome).toBe('refunded')
    expect((await reconcileWithdrawal(client().client, fresh, opts('not_found'))).outcome).toBe('waiting')
  })
})

// sweepWithdrawals is the per-run loop: queries stale rows, calls reconcileWithdrawal per row, counts
// outcomes, records trust only for a row THIS run completed, and notifies the user on a refund. Shared
// by the standalone cron endpoint and the chained call from process-email-outbox.js.
describe('sweepWithdrawals', () => {
  function sweepClient({ rows = [], queryError = null, rpcResults = {} } = {}) {
    const rpcCalls = []
    const q = {
      select: () => q, eq: () => q, not: () => q, lt: () => q, order: () => q, update: () => q,
      limit: async () => ({ data: rows, error: queryError }),
      // Lets `await <chain>` resolve when the chain ends on `.select(...)` right after `.update(...)`
      // (reconcileWithdrawal's completion branch) - `select` itself just returns `q` to keep chaining.
      then: (resolve) => resolve({ data: [{ id: 'flipped' }], error: null }),
    }
    return {
      rpcCalls,
      client: {
        from: () => q,
        rpc: async (name, args) => { rpcCalls.push([name, args]); return rpcResults[name] || { data: 'ok', error: null } },
        auth: { admin: { getUserById: async () => ({ data: { user: { email: 'u@example.com' } } }) } },
      },
    }
  }

  it('counts each row\'s outcome and isolates a row that throws', async () => {
    const rows = [
      { id: 'w1', user_id: 'u1', amount: 10, status: 'pending', paystack_reference: 'r1', paystack_transfer_code: null, created_at: old },
      { id: 'w2', user_id: 'u2', amount: 10, status: 'pending', paystack_reference: 'r2', paystack_transfer_code: 'T', created_at: old },
      { id: 'w3', user_id: 'u3', amount: 10, status: 'pending', paystack_reference: 'r3', paystack_transfer_code: 'T', created_at: old },
      { id: 'w4', user_id: 'u4', amount: 10, status: 'pending', paystack_reference: 'r4', paystack_transfer_code: 'T', created_at: old },
    ]
    const statuses = ['not_found', 'success', 'pending', null] // null -> getStatus throws below
    let i = 0
    const { client } = sweepClient({ rows })
    const summary = await sweepWithdrawals(client, {
      getStatus: async () => { const s = statuses[i++]; if (s === null) throw new Error('boom'); return s },
      now: NOW,
    })
    expect(summary).toEqual({ checked: 4, refunded: 1, completed: 1, waiting: 2, errors: 0 })
  })

  it('records trust only for the row this run completed, never for a refunded or waiting one', async () => {
    const rows = [
      { id: 'w1', user_id: 'u1', amount: 10, status: 'pending', paystack_reference: 'r1', paystack_transfer_code: 'T', created_at: old },
      { id: 'w2', user_id: 'u2', amount: 20, status: 'pending', paystack_reference: 'r2', paystack_transfer_code: 'T', created_at: old },
      { id: 'w3', user_id: 'u3', amount: 30, status: 'pending', paystack_reference: 'r3', paystack_transfer_code: 'T', created_at: old },
    ]
    const statuses = ['failed', 'success', 'pending']
    let i = 0
    const { client, rpcCalls } = sweepClient({ rows })
    await sweepWithdrawals(client, { getStatus: async () => statuses[i++], now: NOW })
    expect(rpcCalls).toEqual([
      ['reject_withdrawal_request', { p_request_id: 'w1' }],
      ['update_withdrawal_trust_after_withdrawal', { p_user_id: 'u2', p_amount: 20, p_status: 'completed' }],
    ])
  })

  it('a query failure throws instead of reporting success', async () => {
    const { client } = sweepClient({ queryError: { message: 'db down' } })
    await expect(sweepWithdrawals(client, { now: NOW })).rejects.toThrow('db down')
  })
})
