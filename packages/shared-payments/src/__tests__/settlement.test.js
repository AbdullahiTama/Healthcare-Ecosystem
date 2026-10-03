import { settleByReference, createPaymentIntent, newReference, markIntentPending, recordProviderEvent, finishProviderEvent, paystackEventId, PaymentIntentError } from '../index.js'

// A tiny scripted supabase client: records every call, answers from the scenario.
function fakeSupabase(scn = {}) {
  const calls = []
  const builder = (table) => {
    const state = { table, op: 'select', filters: [], row: null, patch: null }
    const b = {
      select: () => b,
      insert: (row) => { state.op = 'insert'; state.row = row; return b },
      update: (patch) => { state.op = 'update'; state.patch = patch; return b },
      eq: (k, v) => { state.filters.push([k, v]); return b },
      in: (k, v) => { state.filters.push([k, v]); return b },
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
      then: (res, rej) => Promise.resolve(resolve()).then(res, rej),
    }
    const resolve = () => {
      calls.push({ table, op: state.op, row: state.row, patch: state.patch, filters: state.filters })
      return scn.on?.(state) ?? { data: null, error: null }
    }
    return b
  }
  return { calls, from: builder, rpc: vi.fn(async (name, args) => scn.rpc?.(name, args) ?? { data: null, error: null }) }
}

const REF = 'cf_topup_ab12cd34_0123456789ab'
const intentRow = (over = {}) => ({ id: 'i1', reference: REF, purpose: 'wallet_topup', status: 'pending', ...over })
const verifiedOk = (over = {}) => ({ status: 'success', providerTransactionId: '4099', amountKobo: 100000, currency: 'NGN', ...over })
const providerWith = (v) => ({ name: 'paystack', verifyPayment: vi.fn(async () => (v instanceof Error ? Promise.reject(v) : v)) })

describe('settleByReference', () => {
  it('reports an unknown reference without calling the provider or the engine', async () => {
    const sb = fakeSupabase({ on: () => ({ data: null, error: null }) })
    const p = providerWith(verifiedOk())
    const r = await settleByReference({ supabase: sb, provider: p, reference: REF })
    expect(r.outcome).toBe('unknown_reference')
    expect(p.verifyPayment).not.toHaveBeenCalled()
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('does not even ask the provider when the intent is already settled', async () => {
    const sb = fakeSupabase({ on: () => ({ data: intentRow({ status: 'settled' }), error: null }) })
    const p = providerWith(verifiedOk())
    const r = await settleByReference({ supabase: sb, provider: p, reference: REF })
    expect(r.outcome).toBe('already_settled')
    expect(p.verifyPayment).not.toHaveBeenCalled()
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('hands the PROVIDER\'s verified facts (not anything from the caller) to the engine', async () => {
    const sb = fakeSupabase({ on: () => ({ data: intentRow(), error: null }), rpc: () => ({ data: { outcome: 'settled', purpose: 'wallet_topup', coins: 5 }, error: null }) })
    const p = providerWith(verifiedOk({ providerTransactionId: '777', amountKobo: 95000 }))
    const r = await settleByReference({ supabase: sb, provider: p, reference: REF })
    expect(sb.rpc).toHaveBeenCalledWith('settle_payment_intent', { p_reference: REF, p_provider: 'paystack', p_provider_txn_id: '777', p_amount_kobo: 95000, p_currency: 'NGN' })
    expect(r).toMatchObject({ outcome: 'settled', coins: 5 })
  })

  it.each(['pending', 'abandoned'])('does not settle when the provider reports "%s"', async (status) => {
    const sb = fakeSupabase({ on: () => ({ data: intentRow(), error: null }) })
    const r = await settleByReference({ supabase: sb, provider: providerWith(verifiedOk({ status })), reference: REF })
    expect(r).toMatchObject({ outcome: 'not_paid', providerStatus: status })
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('closes an open attempt the provider says failed, and leaves a merely pending one alone', async () => {
    const failed = fakeSupabase({ on: () => ({ data: intentRow(), error: null }) })
    await settleByReference({ supabase: failed, provider: providerWith(verifiedOk({ status: 'failed' })), reference: REF })
    expect(failed.calls.some((c) => c.op === 'update' && c.patch.status === 'failed')).toBe(true)
    const pending = fakeSupabase({ on: () => ({ data: intentRow(), error: null }) })
    await settleByReference({ supabase: pending, provider: providerWith(verifiedOk({ status: 'pending' })), reference: REF })
    expect(pending.calls.some((c) => c.op === 'update')).toBe(false)
  })

  it('passes a needs_refund outcome (and its reason) straight through', async () => {
    const sb = fakeSupabase({ on: () => ({ data: intentRow(), error: null }), rpc: () => ({ data: { outcome: 'needs_refund', reason: 'amount_mismatch' }, error: null }) })
    const r = await settleByReference({ supabase: sb, provider: providerWith(verifiedOk()), reference: REF })
    expect(r).toMatchObject({ outcome: 'needs_refund', reason: 'amount_mismatch' })
  })

  it('lets a provider failure propagate so the webhook answers 5xx and the provider retries', async () => {
    const sb = fakeSupabase({ on: () => ({ data: intentRow(), error: null }) })
    await expect(settleByReference({ supabase: sb, provider: providerWith(new Error('timeout')), reference: REF })).rejects.toThrow('timeout')
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('throws (so the caller retries) when the engine errors or returns nothing', async () => {
    const boom = fakeSupabase({ on: () => ({ data: intentRow(), error: null }), rpc: () => ({ data: null, error: { message: 'deadlock detected' } }) })
    await expect(settleByReference({ supabase: boom, provider: providerWith(verifiedOk()), reference: REF })).rejects.toThrow(/deadlock/)
    const empty = fakeSupabase({ on: () => ({ data: intentRow(), error: null }), rpc: () => ({ data: null, error: null }) })
    await expect(settleByReference({ supabase: empty, provider: providerWith(verifiedOk()), reference: REF })).rejects.toBeInstanceOf(PaymentIntentError)
  })

  it('redirect and webhook converge: both call the same engine function with the same arguments', async () => {
    const sb = fakeSupabase({ on: () => ({ data: intentRow(), error: null }), rpc: () => ({ data: { outcome: 'settled' }, error: null }) })
    const p = providerWith(verifiedOk())
    await settleByReference({ supabase: sb, provider: p, reference: REF }) // redirect
    await settleByReference({ supabase: sb, provider: p, reference: REF }) // webhook
    expect(sb.rpc.mock.calls.map(([n]) => n)).toEqual(['settle_payment_intent', 'settle_payment_intent'])
    expect(sb.rpc.mock.calls[0][1]).toEqual(sb.rpc.mock.calls[1][1])
  })
})

describe('createPaymentIntent', () => {
  const base = { reference: REF, application: 'carefind', purpose: 'wallet_topup', customerId: 'u1', expectedAmountKobo: 95000, metadata: { coins: 5 } }

  it('inserts what the server decided, in kobo, as NGN', async () => {
    const sb = fakeSupabase({ on: (s) => ({ data: { ...s.row, id: 'i1' }, error: null }) })
    const row = await createPaymentIntent(sb, base)
    const ins = sb.calls[0]
    expect(ins).toMatchObject({ table: 'payment_intents', op: 'insert' })
    expect(ins.row).toMatchObject({ reference: REF, provider: 'paystack', purpose: 'wallet_topup', customer_id: 'u1', expected_amount: 95000, currency: 'NGN', metadata: { coins: 5 } })
    expect(row.id).toBe('i1')
  })

  it.each([
    ['decimal amount', { expectedAmountKobo: 950.5 }],
    ['zero', { expectedAmountKobo: 0 }],
    ['negative', { expectedAmountKobo: -1 }],
    ['string amount', { expectedAmountKobo: '95000' }],
    ['unknown purpose', { purpose: 'free_money' }],
    ['unknown application', { application: 'x' }],
    ['entity half-specified', { entityType: 'appointment' }],
  ])('rejects %s before touching the database', async (_l, over) => {
    const sb = fakeSupabase()
    await expect(createPaymentIntent(sb, { ...base, ...over })).rejects.toBeInstanceOf(PaymentIntentError)
    expect(sb.calls).toHaveLength(0)
  })

  it('maps a duplicate reference to a distinct error', async () => {
    const sb = fakeSupabase({ on: () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) })
    await expect(createPaymentIntent(sb, base)).rejects.toMatchObject({ code: 'duplicate_reference' })
  })

  it('newReference is unguessable, unique and matches the table\'s format', () => {
    const a = newReference('cf_topup', '12345678-aaaa-bbbb')
    const b = newReference('cf_topup', '12345678-aaaa-bbbb')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,100}$/)
    expect(a.startsWith('cf_topup_12345678_')).toBe(true)
  })

  it('markIntentPending only moves a "created" intent (never walks a settled one back)', async () => {
    const sb = fakeSupabase()
    await markIntentPending(sb, 'i1')
    expect(sb.calls[0].filters).toContainEqual(['status', 'created'])
  })
})

describe('provider events', () => {
  const ev = { provider: 'paystack', eventId: 'charge.success:4099', eventType: 'charge.success', reference: REF, payload: { event: 'charge.success' }, signatureOk: true }

  it('stores a first delivery as new', async () => {
    const sb = fakeSupabase({ on: (s) => ({ data: { id: 'e1', ...s.row }, error: null }) })
    expect(await recordProviderEvent(sb, ev)).toMatchObject({ isNew: true, alreadyHandled: false })
  })

  it('recognises a replay of an event that was already handled', async () => {
    const sb = fakeSupabase({
      on: (s) => (s.op === 'insert' ? { data: null, error: { code: '23505', message: 'dup' } } : { data: { id: 'e1', processed_at: '2026-10-03T10:00:00Z', outcome: 'processed' }, error: null }),
    })
    expect(await recordProviderEvent(sb, ev)).toMatchObject({ isNew: false, alreadyHandled: true })
  })

  it('hands back a replay whose earlier attempt FAILED so it is processed again', async () => {
    const sb = fakeSupabase({
      on: (s) => (s.op === 'insert' ? { data: null, error: { code: '23505', message: 'dup' } } : { data: { id: 'e1', processed_at: null, outcome: 'failed', attempts: 1 }, error: null }),
    })
    expect(await recordProviderEvent(sb, ev)).toMatchObject({ isNew: false, alreadyHandled: false })
  })

  it('does not swallow other database errors', async () => {
    const sb = fakeSupabase({ on: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) })
    await expect(recordProviderEvent(sb, ev)).rejects.toBeInstanceOf(PaymentIntentError)
  })

  it('a failed attempt is recorded without stamping processed_at (it is write-once, a retry must still set it)', async () => {
    const sb = fakeSupabase()
    await finishProviderEvent(sb, { id: 'e1', attempts: 1 }, { outcome: 'failed', error: new Error('db down') })
    const patch = sb.calls[0].patch
    expect(patch).toMatchObject({ outcome: 'failed', attempts: 2 })
    expect(patch.processed_at).toBeUndefined()
    expect(patch.last_error).toMatch(/db down/)
  })

  it('a handled event is stamped processed', async () => {
    const sb = fakeSupabase()
    await finishProviderEvent(sb, { id: 'e1', attempts: 0 }, { outcome: 'processed' })
    expect(sb.calls[0].patch.processed_at).toBeTruthy()
  })

  it('derives a stable Paystack event id', () => {
    expect(paystackEventId({ event: 'charge.success', data: { id: 4099, reference: 'r' } })).toBe('charge.success:4099')
    expect(paystackEventId({ event: 'transfer.success', data: { transfer_code: 'TRF_1' } })).toBe('transfer.success:TRF_1')
    expect(paystackEventId({ event: 'x', data: {} })).toBeNull()
    expect(paystackEventId({})).toBeNull()
  })
})
