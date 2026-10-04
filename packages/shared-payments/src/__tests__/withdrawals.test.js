import { describe, it, expect, vi } from 'vitest'
import {
  decideTransferAction, getTransferStatus, verifyBankAccount, normalizeAccountName, settleWithdrawal, settleTransferWebhook, reconcileWithdrawal, sweepWithdrawals, IN_FLIGHT_GRACE_MS,
} from '../withdrawals.js'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const old = new Date(NOW - 20 * 60 * 1000).toISOString()
const fresh = new Date(NOW - 60 * 1000).toISOString()
const row = (over = {}) => ({ id: 'r1', paystack_reference: 'cf_wd_abc', paystack_transfer_code: null, created_at: old, ...over })
const st = (s) => ({ getStatus: async () => s, now: NOW })

// A fake supabase whose rpc() answers per function name (a value, or a function of the args).
const fake = (answers = {}, rows = []) => {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args })
      const a = answers[name]
      const v = typeof a === 'function' ? a(args) : a
      return v?.error ? v : { data: v ?? { result: 'not_found' }, error: null }
    },
    from: (table) => {
      let cutoff
      const chain = {
        select: () => chain, in: () => chain, not: () => chain, order: () => chain,
        lt: (c, v) => { cutoff = v; return chain },
        limit: async () => { calls.push({ sweep: table, cutoff }); return { data: rows, error: null } },
      }
      return chain
    },
  }
}

describe('decideTransferAction', () => {
  it('refunds only when Paystack says the transfer did not happen', async () => {
    for (const s of ['failed', 'reversed', 'abandoned', 'blocked', 'rejected']) {
      expect((await decideTransferAction(row({ paystack_transfer_code: 'T' }), st(s))).action).toBe('refund')
    }
  })
  it('completes when Paystack says success; waits while it is in flight or unrecognised', async () => {
    expect((await decideTransferAction(row({ paystack_transfer_code: 'T' }), st('success'))).action).toBe('complete')
    for (const s of ['pending', 'otp', 'processing', 'queued', 'received', 'weird']) {
      expect((await decideTransferAction(row({ paystack_transfer_code: 'T' }), st(s))).action).toBe('wait')
    }
  })
  it('"not found" is believed only after the grace period and only with no transfer code on file', async () => {
    expect((await decideTransferAction(row(), st('not_found'))).action).toBe('refund')
    expect((await decideTransferAction(row({ created_at: fresh }), st('not_found'))).action).toBe('wait')
    expect((await decideTransferAction(row({ paystack_transfer_code: 'T' }), st('not_found'))).action).toBe('wait')
  })
  it('a request filed moments ago with no code is left alone WITHOUT asking Paystack', async () => {
    const getStatus = vi.fn()
    expect((await decideTransferAction(row({ created_at: fresh }), { getStatus, now: NOW })).action).toBe('wait')
    expect(getStatus).not.toHaveBeenCalled()
  })
  it('a Paystack outage never refunds', async () => {
    const r = await decideTransferAction(row(), { getStatus: async () => { throw new Error('timeout') }, now: NOW })
    expect(r.action).toBe('wait')
    expect(r.message).toMatch(/timeout/)
  })
  it('a request with no reference waits (sweep) or refunds (admin opt-in)', async () => {
    expect((await decideTransferAction(row({ paystack_reference: null }), st('x'))).action).toBe('wait')
    expect((await decideTransferAction(row({ paystack_reference: null }), { ...st('x'), referenceless: 'refund' })).action).toBe('refund')
  })
})

describe('getTransferStatus', () => {
  it('reads the status, maps "not found", and throws on anything else', async () => {
    expect(await getTransferStatus('r', async () => ({ status: true, data: { status: 'SUCCESS' } }))).toBe('success')
    expect(await getTransferStatus('r', async () => ({ status: false, message: 'Transfer not found' }))).toBe('not_found')
    await expect(getTransferStatus('r', async () => ({ status: false, message: 'Invalid key' }))).rejects.toThrow('Invalid key')
  })
})

describe('settleWithdrawal', () => {
  it('passes the outcome and exactly one of reference / request id to the right function', async () => {
    const s = fake({ settle_withdrawal: { result: 'refunded' }, settle_business_withdrawal: { result: 'completed' } })
    await settleWithdrawal(s, 'carefind', { outcome: 'failed', reference: 'cf_wd_1' })
    await settleWithdrawal(s, 'carehub', { outcome: 'success', requestId: 'id-9', reference: 'ignored', amountKobo: 500 })
    expect(s.calls[0]).toEqual({ name: 'settle_withdrawal', args: { p_outcome: 'failed', p_reference: 'cf_wd_1', p_request_id: null, p_amount_kobo: null, p_detail: null } })
    expect(s.calls[1]).toEqual({ name: 'settle_business_withdrawal', args: { p_outcome: 'success', p_reference: null, p_request_id: 'id-9', p_amount_kobo: 500, p_detail: null } })
  })
  it('throws on an RPC error and on an unknown kind', async () => {
    await expect(settleWithdrawal(fake({ settle_withdrawal: { error: { message: 'boom' } } }), 'carefind', { outcome: 'failed', reference: 'x' })).rejects.toThrow('boom')
    await expect(settleWithdrawal(fake(), 'nope', { outcome: 'failed' })).rejects.toThrow(/unknown withdrawal kind/)
  })
})

describe('settleTransferWebhook', () => {
  it('maps the three transfer events and passes the provider amount only for success', async () => {
    const s = fake({ settle_withdrawal: () => ({ result: 'completed', id: 'a' }) })
    const ok = await settleTransferWebhook(s, { event: 'transfer.success', data: { reference: 'cf_wd_1', amount: 160000 } })
    expect(ok).toMatchObject({ handled: true, outcome: 'success', kind: 'carefind', result: { result: 'completed' } })
    expect(s.calls[0].args).toMatchObject({ p_outcome: 'success', p_amount_kobo: 160000 })
    await settleTransferWebhook(s, { event: 'transfer.reversed', data: { reference: 'cf_wd_1', amount: 160000 } })
    expect(s.calls[1].args).toMatchObject({ p_outcome: 'reversed', p_amount_kobo: null })
    await settleTransferWebhook(s, { event: 'transfer.failed', data: { reference: 'cf_wd_1' } })
    expect(s.calls[2].args.p_outcome).toBe('failed')
  })
  it('tries CareHub when CareFind does not know the reference', async () => {
    const s = fake({ settle_withdrawal: { result: 'not_found' }, settle_business_withdrawal: { result: 'refunded', id: 'b' } })
    const r = await settleTransferWebhook(s, { event: 'transfer.failed', data: { reference: 'ch_wd_1' } })
    expect(r).toMatchObject({ kind: 'carehub', result: { result: 'refunded' } })
    expect(s.calls.map((c) => c.name)).toEqual(['settle_withdrawal', 'settle_business_withdrawal'])
  })
  it('an unknown reference is acknowledged but settles nothing; other events and missing references are ignored', async () => {
    expect(await settleTransferWebhook(fake(), { event: 'transfer.failed', data: { reference: 'zzz' } })).toMatchObject({ handled: true, kind: null })
    expect(await settleTransferWebhook(fake(), { event: 'charge.success', data: { reference: 'x' } })).toEqual({ handled: false })
    expect(await settleTransferWebhook(fake(), { event: 'transfer.success', data: {} })).toEqual({ handled: false })
  })
  it('logs conflicts and amount mismatches loudly (they need a human), still returning the result', async () => {
    const logger = { error: vi.fn() }
    for (const result of ['conflict_paid_after_refund', 'conflict_failed_after_completed', 'amount_mismatch']) {
      const r = await settleTransferWebhook(fake({ settle_withdrawal: { result, id: 'a' } }), { event: 'transfer.success', data: { reference: 'cf_wd_1', amount: 1 } }, { logger })
      expect(r.result.result).toBe(result)
    }
    expect(logger.error).toHaveBeenCalledTimes(3)
  })
})

describe('reconcileWithdrawal', () => {
  it('refund decision -> settles as failed by exact id and reports refunded only when this call did it', async () => {
    const s = fake({ settle_withdrawal: { result: 'refunded' } })
    expect(await reconcileWithdrawal(s, 'carefind', row(), st('not_found'))).toMatchObject({ outcome: 'refunded' })
    expect(s.calls[0].args).toMatchObject({ p_outcome: 'failed', p_request_id: 'r1', p_reference: null })
    const late = fake({ settle_withdrawal: { result: 'already_refunded' } })
    expect(await reconcileWithdrawal(late, 'carefind', row(), st('not_found'))).toMatchObject({ outcome: 'waiting', detail: 'already_refunded' })
  })
  it('complete decision -> settles as success; replays are "waiting" so effects cannot run twice', async () => {
    const s = fake({ settle_withdrawal: { result: 'completed' } })
    expect(await reconcileWithdrawal(s, 'carefind', row({ paystack_transfer_code: 'T' }), st('success'))).toMatchObject({ outcome: 'completed' })
    const again = fake({ settle_withdrawal: { result: 'already_completed' } })
    expect((await reconcileWithdrawal(again, 'carefind', row({ paystack_transfer_code: 'T' }), st('success'))).outcome).toBe('waiting')
  })
  it('wait decision touches nothing; an RPC failure becomes waiting, never a refund', async () => {
    const s = fake()
    expect((await reconcileWithdrawal(s, 'carefind', row({ paystack_transfer_code: 'T' }), st('processing'))).outcome).toBe('waiting')
    expect(s.calls).toEqual([])
    const bad = fake({ settle_withdrawal: { error: { message: 'db down' } } })
    expect(await reconcileWithdrawal(bad, 'carefind', row(), st('failed'))).toMatchObject({ outcome: 'waiting', detail: expect.stringContaining('db down') })
  })
})

describe('sweepWithdrawals', () => {
  it('settles each stuck request, runs hooks only for changes it made, and keeps going', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', paystack_transfer_code: 'T' }), row({ id: 'c' })]
    const answers = [{ result: 'refunded' }, { result: 'completed' }, { result: 'already_refunded' }]
    let i = 0
    const s = fake({ settle_withdrawal: () => answers[i++] }, rows)
    const onRefunded = vi.fn()
    const onCompleted = vi.fn()
    const seq = ['failed', 'success', 'failed']
    let k = 0
    const out = await sweepWithdrawals(s, 'carefind', { now: NOW, getStatus: async () => seq[k++], onRefunded, onCompleted, logger: { warn() {}, error() {} } })
    expect(out).toEqual({ checked: 3, refunded: 1, completed: 1, waiting: 1, errors: 0 })
    expect(onRefunded).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(s.calls[0].sweep).toBe('withdrawal_requests')
    expect(s.calls[0].cutoff).toBe(new Date(NOW - IN_FLIGHT_GRACE_MS).toISOString())
  })
  it('uses the business table for CareHub', async () => {
    const s = fake({}, [])
    await sweepWithdrawals(s, 'carehub', { now: NOW, getStatus: async () => 'failed' })
    expect(s.calls[0].sweep).toBe('business_withdrawal_requests')
  })
})

describe('verifyBankAccount', () => {
  const args = { bankCode: '058', accountNumber: '0123456789', accountName: '  ada   OBI ' }
  it('accepts a name that matches after normalisation, and returns the bank spelling', async () => {
    expect(await verifyBankAccount(async () => ({ accountName: 'Ada Obi' }), args)).toEqual({ ok: true, accountName: 'Ada Obi' })
    expect(normalizeAccountName('  ADA   Obi ')).toBe('ada obi')
  })
  it('refuses a name that does not belong to the account', async () => {
    const r = await verifyBankAccount(async () => ({ accountName: 'Someone Else' }), args)
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(r.error).toMatch(/does not match/)
  })
  it('refuses when the bank cannot be asked (never pays an unverified account on a resolver failure)', async () => {
    expect(await verifyBankAccount(async () => { throw new Error('timeout') }, args)).toMatchObject({ ok: false, status: 400 })
    expect(await verifyBankAccount(async () => ({}), args)).toMatchObject({ ok: false })
  })
  it('a bank that does not support resolution falls back to the typed name, flagged unverified', async () => {
    const err = Object.assign(new Error('x'), { paystackMessage: 'This bank is not supported' })
    expect(await verifyBankAccount(async () => { throw err }, args)).toEqual({ ok: true, accountName: 'ada   OBI', unverified: true })
    expect(await verifyBankAccount(async () => { throw err }, { ...args, accountName: '  ' })).toMatchObject({ ok: false })
  })
  it('an empty typed name never matches', async () => {
    expect((await verifyBankAccount(async () => ({ accountName: 'Ada' }), { ...args, accountName: '' })).ok).toBe(false)
  })
})
