import { describe, it, expect, vi } from 'vitest'
import { reconcileWithdrawal } from '../withdrawalRecovery.js'
import { IN_FLIGHT_GRACE_MS } from '../withdrawalAdmin.js'

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
