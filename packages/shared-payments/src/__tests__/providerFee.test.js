import { describe, it, expect, vi } from 'vitest'
import { PaystackProvider, settleByReference, recordProviderFee, backfillProviderFees, reconcileProviderTransactions } from '../index.js'
import { createFakeSupabase } from '../testing.js'

// Paystack keeps a processing fee before paying out to the bank. These tests pin that the fee is read from Paystack,
// stored after every settlement path, backfilled for older payments, and that none of it can change or block a payment.

const REF = 'cf_topup_ab12cd34_0123456789ab'
const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })

// ---- adapter ---------------------------------------------------------------------------------------
const reply = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) })
const paystack = (body) => new PaystackProvider({
  secretKey: 'sk_test_abcdefghijklmnop1234567890',
  http: { fetchImpl: vi.fn(async () => reply(body)), sleep: async () => {}, random: () => 1, logger: quiet() },
})
const charge = (over = {}) => ({ id: 4099, reference: REF, status: 'success', amount: 95000, currency: 'NGN', paid_at: '2026-10-06T10:00:00Z', channel: 'bank', customer: { email: 'a@b.com' }, metadata: {}, fees: 1425, ...over })

describe('PaystackProvider reports the fee it kept', () => {
  it('verifyPayment returns fees as feeKobo (live example: N950 charged, N14.25 fee)', async () => {
    const v = await paystack({ status: true, data: charge() }).verifyPayment({ reference: REF })
    expect(v).toMatchObject({ amountKobo: 95000, feeKobo: 1425 })
  })

  it.each([
    ['missing', undefined], ['null', null], ['a string', '1425'], ['fractional', 14.25], ['negative', -1], ['above the amount', 95001],
  ])('a %s fee is reported as null, never guessed', async (_, fees) => {
    const v = await paystack({ status: true, data: charge({ fees }) }).verifyPayment({ reference: REF })
    expect(v.feeKobo).toBeNull()
    expect(v.amountKobo).toBe(95000)   // the payment itself is unaffected
  })

  it('a zero fee is a real fee', async () => {
    expect((await paystack({ status: true, data: charge({ fees: 0 }) }).verifyPayment({ reference: REF })).feeKobo).toBe(0)
  })

  it('listTransactions carries feeKobo on each row', async () => {
    const r = await paystack({ status: true, data: [charge(), charge({ id: 2, reference: 'cf_shop_ab12cd34_0123456789ab', fees: null })], meta: { pageCount: 1 } })
      .listTransactions({ from: '2026-10-06T00:00:00Z', to: '2026-10-07T00:00:00Z' })
    expect(r.transactions.map((t) => t.feeKobo)).toEqual([1425, null])
  })
})

// ---- settlement --------------------------------------------------------------------------------------
const verified = (over = {}) => ({ status: 'success', reference: REF, providerTransactionId: '4099', amountKobo: 95000, feeKobo: 1425, currency: 'NGN', ...over })
const settleWith = ({ fee = () => 'recorded', settle = () => ({ outcome: 'settled', purpose: 'wallet_topup' }), v = verified() } = {}) => {
  const s = createFakeSupabase({
    tables: { payment_intents: [{ id: 'i1', reference: REF, purpose: 'wallet_topup', status: 'pending', expected_amount: 95000 }] },
    rpc: { settle_payment_intent: settle, record_payment_provider_fee: fee },
  })
  const provider = { name: 'paystack', verifyPayment: vi.fn(async () => v) }
  return { s, provider }
}
const rpcNames = (s) => s.calls.filter((c) => c.op === 'rpc').map((c) => c.name)

describe('settleByReference stores the fee (webhook and redirect callback share this path)', () => {
  it('records the provider\'s fee AFTER settlement, with the provider\'s facts and the settled reference', async () => {
    const { s, provider } = settleWith()
    const r = await settleByReference({ supabase: s, provider, reference: REF })
    expect(rpcNames(s)).toEqual(['settle_payment_intent', 'record_payment_provider_fee'])
    expect(s.calls.find((c) => c.name === 'record_payment_provider_fee').args).toEqual({ p_reference: REF, p_provider: 'paystack', p_provider_txn_id: '4099', p_amount_kobo: 95000, p_fee_kobo: 1425 })
    expect(r).toMatchObject({ outcome: 'settled', fee: 'recorded' })
  })

  it('the settlement call is exactly what it was before: the fee never reaches settle_payment_intent', async () => {
    const { s, provider } = settleWith()
    await settleByReference({ supabase: s, provider, reference: REF })
    expect(s.calls.find((c) => c.name === 'settle_payment_intent').args).toEqual({ p_reference: REF, p_provider: 'paystack', p_provider_txn_id: '4099', p_amount_kobo: 95000, p_currency: 'NGN' })
  })

  it('a database error while storing the fee is logged and the payment still settles', async () => {
    const { s, provider } = settleWith({ fee: () => ({ data: null, error: { message: 'function record_payment_provider_fee does not exist' } }) })
    const logger = quiet()
    const r = await settleByReference({ supabase: s, provider, reference: REF, logger })
    expect(r).toMatchObject({ outcome: 'settled', fee: 'error' })
    expect(logger.warn).toHaveBeenCalledWith('payment.fee_record_failed', expect.objectContaining({ reference: REF }))
  })

  it('a thrown fee call is caught too', async () => {
    const { s, provider } = settleWith({ fee: () => { throw new Error('connection reset') } })
    expect(await settleByReference({ supabase: s, provider, reference: REF, logger: quiet() })).toMatchObject({ outcome: 'settled', fee: 'error' })
  })

  it('a refusal from the database is a warning, not a failure', async () => {
    const { s, provider } = settleWith({ fee: () => 'amount_mismatch' })
    const logger = quiet()
    expect(await settleByReference({ supabase: s, provider, reference: REF, logger })).toMatchObject({ outcome: 'settled', fee: 'amount_mismatch' })
    expect(logger.warn).toHaveBeenCalledWith('payment.fee_refused', expect.objectContaining({ outcome: 'amount_mismatch' }))
  })

  it('no fee from the provider: nothing is written, it is logged, the payment settles', async () => {
    const { s, provider } = settleWith({ v: verified({ feeKobo: null }) })
    const logger = quiet()
    expect(await settleByReference({ supabase: s, provider, reference: REF, logger })).toMatchObject({ outcome: 'settled', fee: 'no_fee' })
    expect(rpcNames(s)).toEqual(['settle_payment_intent'])
    expect(logger.warn).toHaveBeenCalledWith('payment.fee_missing', { reference: REF })
  })

  it('an unpaid payment never reaches the fee', async () => {
    const { s, provider } = settleWith({ v: verified({ status: 'pending' }) })
    await settleByReference({ supabase: s, provider, reference: REF })
    expect(rpcNames(s)).toEqual([])
  })

  it('needs_refund still records the fee (the money was taken); the database decides', async () => {
    const { s, provider } = settleWith({ settle: () => ({ outcome: 'needs_refund', reason: 'already_booked' }) })
    expect(await settleByReference({ supabase: s, provider, reference: REF })).toMatchObject({ outcome: 'needs_refund', fee: 'recorded' })
  })
})

describe('recordProviderFee', () => {
  it('answers with the database outcome and never throws', async () => {
    const s = createFakeSupabase({ rpc: { record_payment_provider_fee: () => 'already_recorded' } })
    expect(await recordProviderFee({ supabase: s, provider: 'paystack', reference: REF, verified: verified() })).toBe('already_recorded')
    const broken = { rpc: async () => { throw new Error('x') } }
    expect(await recordProviderFee({ supabase: broken, provider: 'paystack', reference: REF, verified: verified() })).toBe('error')
  })
})

// ---- reconciliation ------------------------------------------------------------------------------------
const tx = (over = {}) => ({ provider: 'paystack', reference: REF, providerTransactionId: '4099', status: 'success', amountKobo: 95000, feeKobo: 1425, currency: 'NGN', ...over })
const intentRow = (over = {}) => ({ id: 'i1', reference: REF, status: 'settled', purpose: 'wallet_topup', expected_amount: 95000, provider_transaction_id: '4099', provider_fee_kobo: null, ...over })

describe('reconcileProviderTransactions fills in a missing fee', () => {
  const run = (intent, txOver = {}) => {
    const s = createFakeSupabase({ tables: { payment_intents: [intent] }, rpc: { sync_reconciliation_findings: () => ({}), record_payment_provider_fee: () => 'recorded' } })
    const p = { name: 'paystack', verifyPayment: vi.fn(), listTransactions: vi.fn(async () => ({ transactions: [tx(txOver)], hasMore: false, skipped: 0 })) }
    return reconcileProviderTransactions(s, p, { from: '2026-10-06T00:00:00Z', to: '2026-10-07T00:00:00Z' }).then((summary) => ({ s, summary }))
  }

  it('a settled payment with no fee gets the fee from the provider\'s list, and is not a finding', async () => {
    const { s, summary } = await run(intentRow())
    expect(summary).toMatchObject({ feesRecorded: 1, findings: 0 })
    expect(s.calls.find((c) => c.name === 'record_payment_provider_fee').args).toMatchObject({ p_reference: REF, p_fee_kobo: 1425, p_amount_kobo: 95000, p_provider_txn_id: '4099' })
  })

  it.each([
    ['the fee is already stored', intentRow({ provider_fee_kobo: 1425 }), {}],
    ['the provider listed no fee', intentRow(), { feeKobo: null }],
    ['the payment is still open', intentRow({ status: 'created', provider_transaction_id: null }), {}],
  ])('nothing is written when %s', async (_, intent, txOver) => {
    const s = createFakeSupabase({ tables: { payment_intents: [intent] }, rpc: { sync_reconciliation_findings: () => ({}), record_payment_provider_fee: () => 'recorded', settle_payment_intent: () => ({ outcome: 'not_paid' }) } })
    const p = { name: 'paystack', verifyPayment: vi.fn(async () => verified({ status: 'pending' })), listTransactions: vi.fn(async () => ({ transactions: [tx(txOver)], hasMore: false })) }
    await reconcileProviderTransactions(s, p, { from: '2026-10-06T00:00:00Z', to: '2026-10-07T00:00:00Z' })
    expect(s.calls.some((c) => c.name === 'record_payment_provider_fee')).toBe(false)
  })

  it('an amount mismatch is still only a finding: no fee is written for it', async () => {
    const { s, summary } = await run(intentRow(), { amountKobo: 90000 })
    expect(summary.findings).toBe(1)
    expect(s.calls.some((c) => c.name === 'record_payment_provider_fee')).toBe(false)
  })
})

describe('backfillProviderFees (older payments, outside the 48-hour window)', () => {
  const make = ({ rows, verify, fee = () => 'recorded' }) => {
    const s = createFakeSupabase({ rpc: { list_intents_missing_provider_fee: () => rows, record_payment_provider_fee: fee } })
    const p = { name: 'paystack', verifyPayment: vi.fn(verify || (async ({ reference }) => verified({ reference }))) }
    return { s, p }
  }
  const row = (reference) => ({ reference, provider_transaction_id: '4099', expected_amount: 95000, status: 'settled' })

  it('asks the provider about each listed payment and stores its fee', async () => {
    const { s, p } = make({ rows: [row('ref_a_000001'), row('ref_b_000001')] })
    const r = await backfillProviderFees(s, p, { logger: quiet() })
    expect(r).toEqual({ checked: 2, recorded: 2, refused: 0, errors: 0 })
    expect(s.calls.find((c) => c.name === 'list_intents_missing_provider_fee').args).toEqual({ p_provider: 'paystack', p_limit: 25 })
    expect(s.calls.filter((c) => c.name === 'record_payment_provider_fee').map((c) => c.args.p_reference)).toEqual(['ref_a_000001', 'ref_b_000001'])
  })

  it('a provider failure on one payment is counted and does not stop the rest', async () => {
    const { s, p } = make({ rows: [row('ref_a_000001'), row('ref_b_000001')], verify: async ({ reference }) => { if (reference === 'ref_a_000001') throw new Error('timeout'); return verified({ reference }) } })
    expect(await backfillProviderFees(s, p, { logger: quiet() })).toEqual({ checked: 2, recorded: 1, refused: 0, errors: 1 })
  })

  it('a payment the provider no longer reports as successful is left alone', async () => {
    const { s, p } = make({ rows: [row('ref_a_000001')], verify: async () => verified({ status: 'reversed' }) })
    expect(await backfillProviderFees(s, p, { logger: quiet() })).toEqual({ checked: 1, recorded: 0, refused: 1, errors: 0 })
    expect(s.calls.some((c) => c.name === 'record_payment_provider_fee')).toBe(false)
  })

  it('a refusal from the database is counted as refused', async () => {
    const { s, p } = make({ rows: [row('ref_a_000001')], fee: () => 'transaction_mismatch' })
    expect(await backfillProviderFees(s, p, { logger: quiet() })).toMatchObject({ refused: 1, recorded: 0 })
  })

  it('stops at the deadline', async () => {
    const { s, p } = make({ rows: [row('ref_a_000001')] })
    expect(await backfillProviderFees(s, p, { deadline: Date.now() - 1 })).toEqual({ checked: 0, recorded: 0, refused: 0, errors: 0 })
    expect(p.verifyPayment).not.toHaveBeenCalled()
  })

  it('a failing work list is an error for the step (reported by runReconciliation), not a silent pass', async () => {
    const s = createFakeSupabase({ rpc: { list_intents_missing_provider_fee: () => ({ data: null, error: { message: 'missing function' } }) } })
    await expect(backfillProviderFees(s, { name: 'paystack', verifyPayment: vi.fn() })).rejects.toThrow(/list_intents_missing_provider_fee/)
  })
})
