import { describe, it, expect, vi, beforeEach } from 'vitest'

// What the customer is told after a CareFind withdrawal settles: their real name, the naira actually paid out, the coins, the bank
// and ONLY the last four digits; one e-mail per withdrawal (the key is the reference); an enqueue that fails is logged, not lost
// silently and not thrown into the settlement.
const h = vi.hoisted(() => ({ enqueue: vi.fn(async () => ({ id: 'o1' })), flush: vi.fn(async () => {}) }))
vi.mock('../emailService.js', () => ({ enqueue: h.enqueue, processBatch: h.flush }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

import { applyWithdrawalResult, applyWithdrawalInFlight, emailWithdrawalCompleted } from '../withdrawalEffects.js'

const supabase = ({ user = { email: 'ada@example.com', user_metadata: { full_name: 'Ada Obi' } }, bank = { bank_name: 'GTBank', account_number: '0123456789' } } = {}) => ({
  rpc: vi.fn(async () => ({ error: null })),
  auth: { admin: { getUserById: async () => ({ data: { user } }) } },
  from: () => { const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: bank }) }; return b },
})
const result = (over = {}) => ({ id: 'w1', user_id: 'u1', amount: 10, payout_kobo: 160000, reference: 'cf_wd_1', from_status: 'processing', result: 'completed', ...over })

beforeEach(() => { h.enqueue.mockReset().mockResolvedValue({ id: 'o1' }); h.flush.mockReset().mockResolvedValue(undefined); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('applyWithdrawalResult', () => {
  it('completed: real name, naira paid out, coins, bank and the last four digits only; keyed by the reference', async () => {
    await applyWithdrawalResult(supabase(), 'success', result())
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    const m = h.enqueue.mock.calls[0][0]
    expect(m).toMatchObject({ templateKey: 'withdrawal_completed', toEmail: 'ada@example.com', sourceId: 'w1', idempotencyKey: 'withdrawal-completed:cf_wd_1', subject: 'CareFind: withdrawal settled' })
    expect(m.payload).toMatchObject({ fullName: 'Ada Obi', coins: '10', reference: 'cf_wd_1', bankName: 'GTBank', accountNumber: '••••6789' })
    expect(m.payload.amount).toContain('1,600')
    expect(JSON.stringify(m)).not.toContain('0123456789')
    expect(m.payload.fullName).not.toContain('@')
  })

  it('refunded: the failure e-mail with the coins returned, under its own key; trust records a failure only for a transfer that never completed', async () => {
    const s = supabase()
    await applyWithdrawalResult(s, 'failed', result({ result: 'refunded', from_status: 'processing' }))
    expect(h.enqueue.mock.calls[0][0]).toMatchObject({ templateKey: 'withdrawal_failed', idempotencyKey: 'withdrawal-failed:cf_wd_1' })
    expect(h.enqueue.mock.calls[0][0].payload.coins).toBe('10')
    expect(s.rpc).toHaveBeenCalledWith('update_withdrawal_trust_after_withdrawal', expect.objectContaining({ p_status: 'failed' }))
    const s2 = supabase()
    await applyWithdrawalResult(s2, 'reversed', result({ result: 'refunded', from_status: 'completed' }))
    expect(s2.rpc).not.toHaveBeenCalled()
  })

  it('a replayed or no-op result sends nothing', async () => {
    for (const r of ['already_completed', 'already_refunded', 'conflict_paid_after_refund', 'amount_mismatch', 'not_found']) await applyWithdrawalResult(supabase(), 'success', result({ result: r }))
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('no address: nothing is sent and nothing throws', async () => {
    await expect(applyWithdrawalResult(supabase({ user: null }), 'success', result())).resolves.toBeUndefined()
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('an enqueue failure is logged as email.enqueue_failed (no address), never thrown, and the outbox is not flushed', async () => {
    h.enqueue.mockRejectedValueOnce(new Error('insert failed for ada@example.com'))
    await expect(applyWithdrawalResult(supabase(), 'success', result())).resolves.toBeUndefined()
    const line = console.error.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('email.enqueue_failed'))
    expect(line).toContain('withdrawal_completed')
    expect(line).not.toContain('ada@example.com')
    expect(h.flush).not.toHaveBeenCalled()
  })
})

describe('the slow-transfer notice and the backfill entry point', () => {
  it('applyWithdrawalInFlight sends one processing e-mail keyed by the reference', async () => {
    await applyWithdrawalInFlight(supabase(), { id: 'w1', user_id: 'u1', amount: 10, payout_kobo: 160000, paystack_reference: 'cf_wd_1' })
    expect(h.enqueue.mock.calls[0][0]).toMatchObject({ templateKey: 'withdrawal_processing', idempotencyKey: 'withdrawal-processing:cf_wd_1' })
    expect(h.enqueue.mock.calls[0][0].payload.accountNumber).toBe('••••6789')
  })

  it('a row with no user or no reference sends nothing', async () => {
    await applyWithdrawalInFlight(supabase(), { id: 'w1', paystack_reference: 'x' })
    await applyWithdrawalInFlight(supabase(), { id: 'w1', user_id: 'u1' })
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('emailWithdrawalCompleted (used by the backfill) never records trust', async () => {
    const s = supabase()
    await emailWithdrawalCompleted(s, { id: 'w1', user_id: 'u1', amount: 10, payout_kobo: 160000, reference: 'cf_wd_1' })
    expect(s.rpc).not.toHaveBeenCalled()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })
})
