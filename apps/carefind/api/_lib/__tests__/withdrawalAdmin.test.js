import { describe, it, expect, vi } from 'vitest'
import { decideAdminApprove, decideAdminReject, getTransferStatus, IN_FLIGHT_GRACE_MS } from '../withdrawalAdmin.js'

const NOW = Date.parse('2026-10-02T12:00:00Z')
const old = new Date(NOW - IN_FLIGHT_GRACE_MS - 60_000).toISOString()
const fresh = new Date(NOW - 30_000).toISOString()

const auto = (extra = {}) => ({ id: 'w1', status: 'pending', paystack_reference: 'cf_wd_1', paystack_transfer_code: 'TRF_1', created_at: old, ...extra })

describe('decideAdminApprove', () => {
  it('never approves: withdrawals are settled automatically, with or without a Paystack reference', () => {
    expect(decideAdminApprove(auto()).action).toBe('block')
    expect(decideAdminApprove({ paystack_reference: null }).action).toBe('block')
  })
})

describe('decideAdminReject', () => {
  const run = (row, status) => decideAdminReject(row, { getStatus: vi.fn(async () => status), now: NOW })

  it('legacy manual row: refunds without asking Paystack', async () => {
    const getStatus = vi.fn()
    const d = await decideAdminReject({ paystack_reference: null }, { getStatus, now: NOW })
    expect(d.action).toBe('refund')
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('transfer succeeded: completes instead of refunding (the double-payout case)', async () => {
    expect((await run(auto(), 'success')).action).toBe('complete')
  })

  it.each(['pending', 'otp', 'processing', 'queued', 'received'])('transfer %s: blocks the refund', async (s) => {
    const d = await run(auto(), s)
    expect(d.action).toBe('block')
  })

  it.each(['failed', 'reversed', 'abandoned', 'blocked', 'rejected'])('transfer %s: allows the refund', async (s) => {
    expect((await run(auto(), s)).action).toBe('refund')
  })

  it('cannot reach Paystack: blocks, never refunds on an unverified guess', async () => {
    const d = await decideAdminReject(auto(), { getStatus: async () => { throw new Error('timeout') }, now: NOW })
    expect(d.action).toBe('block')
    expect(d.message).toMatch(/Nothing was refunded/)
  })

  it('unrecognised status: blocks', async () => {
    expect((await run(auto(), 'something_new')).action).toBe('block')
  })

  it('no transfer code and filed moments ago: blocks without asking (a transfer call may be in flight)', async () => {
    const getStatus = vi.fn()
    const d = await decideAdminReject(auto({ paystack_transfer_code: null, created_at: fresh }), { getStatus, now: NOW })
    expect(d.action).toBe('block')
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('no transfer code, old, Paystack has never heard of it: refunds', async () => {
    expect((await run(auto({ paystack_transfer_code: null }), 'not_found')).action).toBe('refund')
  })

  it('transfer code on file but Paystack says not found: blocks (inconsistent, do not refund)', async () => {
    expect((await run(auto(), 'not_found')).action).toBe('block')
  })
})

describe('getTransferStatus', () => {
  it('reads the transfer status by reference', async () => {
    const fetcher = vi.fn(async () => ({ status: true, data: { status: 'SUCCESS' } }))
    expect(await getTransferStatus('cf wd/1', fetcher)).toBe('success')
    expect(fetcher).toHaveBeenCalledWith('/transfer/verify/cf%20wd%2F1')
  })
  it('maps "not found" to not_found', async () => {
    expect(await getTransferStatus('x', async () => ({ status: false, message: 'Transfer not found' }))).toBe('not_found')
  })
  it('throws on any other failure', async () => {
    await expect(getTransferStatus('x', async () => ({ status: false, message: 'Invalid key' }))).rejects.toThrow('Invalid key')
  })
})
