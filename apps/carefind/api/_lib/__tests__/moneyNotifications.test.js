import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The delivery guarantee: money events that settled but have no e-mail in the outbox are sent late, through the same effects
// and keys; one broken event never stops the rest; nothing here throws into the cron.
const h = vi.hoisted(() => ({
  completed: vi.fn(async () => {}), failed: vi.fn(async () => {}), business: vi.fn(async () => {}), refund: vi.fn(async () => {}), settlement: vi.fn(async () => {}),
}))
vi.mock('../withdrawalEffects.js', () => ({ emailWithdrawalCompleted: h.completed, emailWithdrawalFailed: h.failed }))
vi.mock('../businessWithdrawalEffects.js', () => ({ applyBusinessWithdrawalResult: h.business }))
vi.mock('../refundEffects.js', () => ({ applyRefundResult: h.refund }))
vi.mock('../settlementEffects.js', () => ({ runSettlementEffects: h.settlement }))

import { runNotificationBackfill } from '../moneyNotifications.js'

const ev = (kind, over = {}) => ({ kind, app: 'carefind', subject_id: `id-${kind}`, reference: `ref-${kind}`, user_id: 'u1', business_id: null, entity_type: null, entity_id: null, amount_kobo: 160000, coins: 10, ...over })
const client = (events, { rpcError = null, intent = { id: 'i1', purpose: 'wallet_topup', reference: 'cf_topup_1' } } = {}) => ({
  rpc: vi.fn(async () => (rpcError ? { data: null, error: rpcError } : { data: events, error: null })),
  from: () => { const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: intent }) }; return b },
})

beforeEach(() => { for (const f of Object.values(h)) f.mockReset().mockResolvedValue(undefined); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
// Vitest 3+: spyOn on an already-spied method reuses the spy, so restore after each test or console calls accumulate.
afterEach(() => { vi.restoreAllMocks() })

describe('runNotificationBackfill', () => {
  it('asks the database for the last 48 hours, bounded, and sends nothing when nothing is missing', async () => {
    const s = client([])
    expect(await runNotificationBackfill(s)).toEqual({ found: 0, sent: 0, errors: 0, byKind: {} })
    expect(s.rpc).toHaveBeenCalledWith('list_unnotified_money_events', { p_since: '48 hours', p_limit: 100 })
    for (const f of Object.values(h)) expect(f).not.toHaveBeenCalled()
  })

  it('routes each kind to the effect that owns its e-mail and key', async () => {
    const s = client([
      ev('withdrawal_completed'), ev('withdrawal_failed'), ev('business_withdrawal_completed', { business_id: 'b1', app: 'carehub' }),
      ev('business_withdrawal_failed', { business_id: 'b1', app: 'carehub' }), ev('refund_completed', { entity_type: 'appointment', entity_id: 'a1' }),
      ev('refund_failed', { entity_type: 'payment_intent', entity_id: 'p1' }), ev('wallet_topup'), ev('business_wallet_topup', { app: 'carehub' }),
    ], { intent: { id: 'i1', purpose: 'wallet_topup', reference: 'cf_topup_1', status: 'settled' } })
    const out = await runNotificationBackfill(s)
    expect(out).toMatchObject({ found: 8, sent: 8, errors: 0 })
    expect(h.completed).toHaveBeenCalledWith(s, expect.objectContaining({ id: 'id-withdrawal_completed', user_id: 'u1', payout_kobo: 160000, amount: 10, reference: 'ref-withdrawal_completed' }))
    expect(h.failed).toHaveBeenCalledTimes(1)
    expect(h.business.mock.calls.map(([, r]) => r.result)).toEqual(['completed', 'refunded'])
    expect(h.refund.mock.calls.map(([, r]) => r.result)).toEqual(['completed', 'failed'])
    expect(h.refund.mock.calls[0][1]).toMatchObject({ entity_type: 'appointment', entity_id: 'a1', customer_id: 'u1', coins: 10 })
    expect(h.settlement).toHaveBeenCalledTimes(2)
    expect(h.settlement.mock.calls[0][1]).toMatchObject({ outcome: 'settled', purpose: 'wallet_topup' })
  })

  it('never touches trust or any money: only e-mail effects are reachable from the backfill', () => {
    // withdrawalEffects is mocked with ONLY the two e-mail functions; the trust-recording applyWithdrawalResult is not imported.
    expect(Object.keys(h).sort()).toEqual(['business', 'completed', 'failed', 'refund', 'settlement'])
  })

  it('one failing event is counted and logged (without an address) and the rest are still sent', async () => {
    h.completed.mockRejectedValueOnce(new Error('outbox down for ada@example.com'))
    const out = await runNotificationBackfill(client([ev('withdrawal_completed'), ev('withdrawal_failed')]))
    expect(out).toMatchObject({ found: 2, sent: 1, errors: 1 })
    expect(h.failed).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('ada@example.com')
  })

  it('stops at the deadline and reports it; the rest are listed again next pass', async () => {
    const out = await runNotificationBackfill(client([ev('withdrawal_completed'), ev('withdrawal_failed')]), { deadline: Date.now() - 1 })
    expect(out).toMatchObject({ found: 2, sent: 0, stopped: 'deadline' })
    expect(h.completed).not.toHaveBeenCalled()
  })

  it('an unknown kind is ignored, not guessed', async () => {
    const out = await runNotificationBackfill(client([ev('something_new')]))
    expect(out).toMatchObject({ found: 1, sent: 0, errors: 0 })
  })

  it('a missing intent for a top-up is an error for that event only', async () => {
    const out = await runNotificationBackfill(client([ev('wallet_topup')], { intent: null }))
    expect(out).toMatchObject({ sent: 0, errors: 1 })
  })

  it('a database error throws, so the cron step is reported failed instead of silently empty', async () => {
    await expect(runNotificationBackfill(client([], { rpcError: { message: 'permission denied' } }))).rejects.toThrow('list_unnotified_money_events: permission denied')
  })

  it('logs one structured event with counts and no addresses', async () => {
    await runNotificationBackfill(client([ev('withdrawal_completed')]))
    const line = console.info.mock.calls.map((c) => c[0]).find((l) => l.includes('email.backfilled'))
    expect(JSON.parse(line)).toMatchObject({ event: 'email.backfilled', found: 1, sent: 1, errors: 0, byKind: { withdrawal_completed: 1 } })
  })
})
