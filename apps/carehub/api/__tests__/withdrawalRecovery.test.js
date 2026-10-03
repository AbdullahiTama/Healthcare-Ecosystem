import { describe, it, expect, vi } from 'vitest'
import {
  decideRecovery,
  getTransferStatus,
  reconcileBusinessWithdrawal,
  reconcileBusinessWithdrawals,
  IN_FLIGHT_GRACE_MS,
} from '../_lib/withdrawalRecovery.js'

// Financial audit H-1 / H-2 for CareHub business withdrawals: refunding while Paystack may still be
// paying the business is a double payout, so every refund is gated on Paystack's own answer.

const NOW = Date.parse('2026-10-02T12:00:00Z')
const old = new Date(NOW - IN_FLIGHT_GRACE_MS - 60_000).toISOString()
const fresh = new Date(NOW - 30_000).toISOString()
const row = (extra = {}) => ({ id: 'w1', status: 'processing', paystack_reference: 'ch_wd_1', paystack_transfer_code: 'TRF_1', created_at: old, ...extra })
const opts = (status) => ({ getStatus: vi.fn(async () => status), now: NOW })

describe('decideRecovery', () => {
  it('succeeded: complete, never refund', async () => {
    expect((await decideRecovery(row(), opts('success'))).action).toBe('complete')
  })
  it.each(['pending', 'otp', 'processing', 'queued', 'received'])('%s: wait', async (s) => {
    expect((await decideRecovery(row(), opts(s))).action).toBe('wait')
  })
  it.each(['failed', 'reversed', 'abandoned', 'blocked', 'rejected'])('%s: refund', async (s) => {
    expect((await decideRecovery(row(), opts(s))).action).toBe('refund')
  })
  it('no transfer code, old, never created at Paystack: refund', async () => {
    expect((await decideRecovery(row({ paystack_transfer_code: null }), opts('not_found'))).action).toBe('refund')
  })
  it('transfer code on file but Paystack says not found: wait (inconsistent)', async () => {
    expect((await decideRecovery(row(), opts('not_found'))).action).toBe('wait')
  })
  it('fresh request without a code: wait without asking Paystack', async () => {
    const o = opts('not_found')
    expect((await decideRecovery(row({ paystack_transfer_code: null, created_at: fresh }), o)).action).toBe('wait')
    expect(o.getStatus).not.toHaveBeenCalled()
  })
  it('graceMs 0 lets a fresh row be verified immediately', async () => {
    const r = row({ paystack_transfer_code: null, created_at: fresh })
    expect((await decideRecovery(r, { ...opts('not_found'), graceMs: 0 })).action).toBe('refund')
  })
  it('Paystack unreachable or unknown status: wait, never refund on a guess', async () => {
    expect((await decideRecovery(row(), { getStatus: async () => { throw new Error('down') }, now: NOW })).action).toBe('wait')
    expect((await decideRecovery(row(), opts('mystery'))).action).toBe('wait')
  })
  it('a row with no reference is not an automated withdrawal: wait', async () => {
    expect((await decideRecovery(row({ paystack_reference: null }), opts('failed'))).action).toBe('wait')
  })
})

describe('getTransferStatus', () => {
  it('reads status by reference, maps not found, throws otherwise', async () => {
    const f = vi.fn(async () => ({ status: true, data: { status: 'SUCCESS' } }))
    expect(await getTransferStatus('a b', f)).toBe('success')
    expect(f).toHaveBeenCalledWith('/transfer/verify/a%20b')
    expect(await getTransferStatus('x', async () => ({ status: false, message: 'Transfer not found' }))).toBe('not_found')
    await expect(getTransferStatus('x', async () => ({ status: false, message: 'Invalid key' }))).rejects.toThrow('Invalid key')
  })
})

function client({ rpc = { data: 'ok', error: null }, rows = [], queryError = null } = {}) {
  const updates = []
  const q = {
    select: () => q, in: () => q, not: () => q, lt: () => q, order: () => q, eq: () => q,
    update: (v) => { updates.push(v); return q },
    limit: async () => ({ data: rows, error: queryError }),
    then: (r) => r({ error: null }),
  }
  return { client: { rpc: vi.fn(async () => rpc), from: () => q }, updates }
}

describe('reconcileBusinessWithdrawal', () => {
  it('refunds through reject_business_withdrawal when Paystack says it failed', async () => {
    const { client: c } = client()
    expect(await reconcileBusinessWithdrawal(c, row(), opts('failed'))).toEqual({ outcome: 'refunded' })
    expect(c.rpc).toHaveBeenCalledWith('reject_business_withdrawal', { p_request_id: 'w1' })
  })
  it('completes (no refund) when the transfer succeeded', async () => {
    const { client: c, updates } = client()
    expect((await reconcileBusinessWithdrawal(c, row(), opts('success'))).outcome).toBe('completed')
    expect(updates).toEqual([{ status: 'completed' }])
    expect(c.rpc).not.toHaveBeenCalled()
  })
  it('waits when a concurrent path (the transfer webhook) already settled the row', async () => {
    const { client: c } = client({ rpc: { data: 'already_rejected', error: null } })
    expect(await reconcileBusinessWithdrawal(c, row(), opts('failed'))).toEqual({ outcome: 'waiting', detail: 'already_rejected' })
  })
})

describe('reconcileBusinessWithdrawals (sweep)', () => {
  it('summarises outcomes and isolates a failing row', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]
    const { client: c } = client({ rows })
    const statuses = ['failed', 'success', 'pending']
    let i = 0
    const summary = await reconcileBusinessWithdrawals(c, { now: NOW, getStatus: async () => statuses[i++] })
    expect(summary).toEqual({ checked: 3, refunded: 1, completed: 1, waiting: 1, errors: 0 })
  })
  it('a query failure throws instead of reporting success', async () => {
    const { client: c } = client({ queryError: { message: 'db down' } })
    await expect(reconcileBusinessWithdrawals(c, { now: NOW })).rejects.toThrow('db down')
  })
})
