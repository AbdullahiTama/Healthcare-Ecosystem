import { PaystackProvider, ProviderError, assertPaymentProvider, PROVIDER_METHODS } from '../index.js'

const SECRET = 'sk_test_abcdefghijklmnop1234567890'
const PAY_REF = 'cf_pay_ab12cd34_0123456789ab'
const TRF_REF = 'cf_wd_ab12cd34_0123456789ab'

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => JSON.stringify(body),
})

function make(responder, over = {}) {
  const calls = []
  const logs = []
  const fetchImpl = vi.fn(async (url, init) => {
    const u = new URL(url)
    calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers })
    return responder(u.pathname, init)
  })
  const provider = new PaystackProvider({
    secretKey: SECRET,
    http: { fetchImpl, sleep: async () => {}, random: () => 1, logger: { info: (m, f) => logs.push([m, f]), warn: (m, f) => logs.push([m, f]), error: (m, f) => logs.push([m, f]) }, ...over },
  })
  return { provider, calls, logs, fetchImpl }
}

const txn = (over = {}) => ({
  status: true,
  message: 'Verification successful',
  data: { id: 4099260516, reference: PAY_REF, status: 'success', amount: 500000, currency: 'NGN', paid_at: '2026-10-03T10:00:00.000Z', channel: 'card', customer: { email: 'a@b.com' }, metadata: { user_id: 'u1', coins: 25 }, ...over },
})

describe('PaystackProvider: contract', () => {
  it('implements the full PaymentProvider interface', () => {
    const { provider } = make(() => reply(200, {}))
    expect(assertPaymentProvider(provider)).toBe(provider)
    expect(PROVIDER_METHODS).toHaveLength(10)
  })

  it('assertPaymentProvider rejects an incomplete provider', () => {
    expect(() => assertPaymentProvider({ name: 'x', verifyPayment() {} })).toThrow(/missing/)
  })
})

describe('PaystackProvider: initializePayment', () => {
  it('sends integer kobo, NGN, the reference and metadata, and returns the checkout URL', async () => {
    const { provider, calls } = make(() => reply(200, { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'ac', reference: PAY_REF } }))
    const out = await provider.initializePayment({ reference: PAY_REF, amountKobo: 500000, email: 'a@b.com', callbackUrl: 'https://app/x', metadata: { k: 1 } })
    expect(out).toEqual({ reference: PAY_REF, authorizationUrl: 'https://checkout.paystack.com/abc', accessCode: 'ac' })
    expect(calls[0]).toMatchObject({ path: '/transaction/initialize', method: 'POST', body: { reference: PAY_REF, amount: 500000, currency: 'NGN', email: 'a@b.com', callback_url: 'https://app/x', metadata: { k: 1 } } })
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET}`)
  })

  it.each([
    ['decimal amount', { amountKobo: 100.5 }],
    ['zero', { amountKobo: 0 }],
    ['negative', { amountKobo: -1 }],
    ['string amount', { amountKobo: '5000' }],
    ['NaN', { amountKobo: NaN }],
    ['non-NGN currency', { currency: 'USD' }],
    ['short reference', { reference: 'abc' }],
    ['reference with spaces', { reference: 'has spaces in it 123' }],
    ['no email', { email: '' }],
  ])('rejects %s locally, without calling the provider', async (_l, over) => {
    const { provider, fetchImpl } = make(() => reply(200, {}))
    const err = await provider.initializePayment({ reference: PAY_REF, amountKobo: 500000, email: 'a@b.com', ...over }).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.code).toBe('invalid_request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces a provider refusal delivered as HTTP 200 + status:false, and a duplicate reference', async () => {
    const refused = make(() => reply(200, { status: false, message: 'Invalid amount' }))
    expect((await refused.provider.initializePayment({ reference: PAY_REF, amountKobo: 100, email: 'a@b.com' }).catch((e) => e)).code).toBe('provider_rejected')
    const dup = make(() => reply(400, { status: false, message: 'Duplicate Transaction Reference' }))
    expect((await dup.provider.initializePayment({ reference: PAY_REF, amountKobo: 100, email: 'a@b.com' }).catch((e) => e)).code).toBe('duplicate_reference')
  })

  it('does not retry a timed-out initialisation and reports it ambiguous', async () => {
    const { provider, fetchImpl } = make(() => { throw new Error('socket hang up') })
    const err = await provider.initializePayment({ reference: PAY_REF, amountKobo: 100, email: 'a@b.com' }).catch((e) => e)
    expect(err.ambiguous).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('PaystackProvider: verifyPayment', () => {
  it('normalises a successful transaction', async () => {
    const { provider, calls } = make(() => reply(200, txn()))
    const v = await provider.verifyPayment({ reference: PAY_REF })
    expect(v).toMatchObject({ provider: 'paystack', reference: PAY_REF, providerTransactionId: '4099260516', status: 'success', amountKobo: 500000, currency: 'NGN', payerEmail: 'a@b.com', channel: 'card', metadata: { user_id: 'u1', coins: 25 } })
    expect(calls[0].path).toBe(`/transaction/verify/${PAY_REF}`)
  })

  it.each([
    ['success', 'success'], ['failed', 'failed'], ['abandoned', 'abandoned'], ['reversed', 'reversed'],
    ['ongoing', 'pending'], ['pending', 'pending'], ['processing', 'pending'], ['queued', 'pending'],
  ])('maps Paystack status %s to %s', async (from, to) => {
    const { provider } = make(() => reply(200, txn({ status: from })))
    expect((await provider.verifyPayment({ reference: PAY_REF })).status).toBe(to)
  })

  it('refuses an unknown status instead of guessing', async () => {
    const { provider } = make(() => reply(200, txn({ status: 'mystery' })))
    expect((await provider.verifyPayment({ reference: PAY_REF }).catch((e) => e)).code).toBe('invalid_response')
  })

  it('refuses a response describing a DIFFERENT transaction than the one requested', async () => {
    const { provider } = make(() => reply(200, txn({ reference: 'someone_elses_ref_00000001' })))
    expect((await provider.verifyPayment({ reference: PAY_REF }).catch((e) => e)).code).toBe('invalid_response')
  })

  it.each([[500.5], [-1], ['5000'], [null]])('refuses a non-integer/invalid amount %p from the provider', async (amount) => {
    const { provider } = make(() => reply(200, txn({ amount })))
    expect((await provider.verifyPayment({ reference: PAY_REF }).catch((e) => e)).code).toBe('invalid_response')
  })

  it('parses metadata delivered as a JSON string, and tolerates null/garbage', async () => {
    expect((await make(() => reply(200, txn({ metadata: '{"order_id":"o1"}' }))).provider.verifyPayment({ reference: PAY_REF })).metadata).toEqual({ order_id: 'o1' })
    expect((await make(() => reply(200, txn({ metadata: null }))).provider.verifyPayment({ reference: PAY_REF })).metadata).toEqual({})
    expect((await make(() => reply(200, txn({ metadata: 'not json' }))).provider.verifyPayment({ reference: PAY_REF })).metadata).toEqual({})
  })

  it('reports an unknown reference as not_found', async () => {
    const { provider } = make(() => reply(404, { status: false, message: 'Transaction reference not found' }))
    expect((await provider.verifyPayment({ reference: PAY_REF }).catch((e) => e)).code).toBe('not_found')
  })

  // Paystack's real reply for a reference it never saw (a checkout that never opened) is a 400, sometimes a 200 + status:false.
  it.each([
    ['HTTP 400', 400],
    ['HTTP 200 + status:false', 200],
  ])('reports Paystack\'s "Transaction reference not found" (%s) as not_found, once, without retrying', async (_, status) => {
    const { provider, fetchImpl } = make(() => reply(status, { status: false, message: 'Transaction reference not found.' }))
    const err = await provider.verifyPayment({ reference: PAY_REF }).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).toMatchObject({ code: 'not_found', operation: 'verifyPayment', retryable: false, ambiguous: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps any other 400 refusal as invalid_request', async () => {
    const { provider } = make(() => reply(400, { status: false, message: 'Invalid key' }))
    expect((await provider.verifyPayment({ reference: PAY_REF }).catch((e) => e)).code).toBe('invalid_request')
  })

  it('retries a read through a transient 503', async () => {
    let n = 0
    const { provider, fetchImpl } = make(() => (++n === 1 ? reply(503, {}) : reply(200, txn())))
    expect((await provider.verifyPayment({ reference: PAY_REF })).status).toBe('success')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('PaystackProvider: refundPayment', () => {
  it.each([
    ['pending', 'processing'], ['processing', 'processing'], ['needs-attention', 'processing'], ['processed', 'completed'], ['failed', 'failed'],
  ])('maps refund status %s to %s', async (from, to) => {
    const { provider, calls } = make(() => reply(200, { status: true, data: { id: 77, status: from, amount: 250000 } }))
    const r = await provider.refundPayment({ reference: PAY_REF, amountKobo: 250000, reason: 'duplicate' })
    expect(r).toMatchObject({ providerRefundId: '77', status: to, amountKobo: 250000 })
    expect(calls[0]).toMatchObject({ path: '/refund', method: 'POST', body: { transaction: PAY_REF, amount: 250000, customer_note: 'duplicate' } })
  })

  it('refuses a decimal refund amount locally and never retries a refund that timed out', async () => {
    const bad = make(() => reply(200, {}))
    expect((await bad.provider.refundPayment({ reference: PAY_REF, amountKobo: 10.5 }).catch((e) => e)).code).toBe('invalid_request')
    expect(bad.fetchImpl).not.toHaveBeenCalled()
    const flaky = make(() => reply(503, {}))
    const err = await flaky.provider.refundPayment({ reference: PAY_REF }).catch((e) => e)
    expect(err.ambiguous).toBe(true)
    expect(flaky.fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('PaystackProvider: verifyRefund', () => {
  it.each([['pending', 'processing'], ['processed', 'completed'], ['failed', 'failed']])('maps %s to %s (object or list reply)', async (from, to) => {
    for (const shape of [(d) => d, (d) => [d]]) {
      const { provider, calls } = make(() => reply(200, { status: true, data: shape({ id: 9, status: from, amount: 250000 }) }))
      expect(await provider.verifyRefund({ reference: PAY_REF })).toMatchObject({ providerRefundId: '9', status: to, amountKobo: 250000 })
      expect(calls[0]).toMatchObject({ path: `/refund/${PAY_REF}`, method: 'GET' })
    }
  })
  it('an empty reply is not_found, an unknown status is refused, and a bad reference never reaches the provider', async () => {
    expect((await make(() => reply(200, { status: true, data: [] })).provider.verifyRefund({ reference: PAY_REF }).catch((e) => e)).code).toBe('not_found')
    expect((await make(() => reply(200, { status: true, data: { id: 1, status: 'weird' } })).provider.verifyRefund({ reference: PAY_REF }).catch((e) => e)).code).toBe('invalid_response')
    const bad = make(() => reply(200, {}))
    expect((await bad.provider.verifyRefund({ reference: 'no spaces allowed' }).catch((e) => e)).code).toBe('invalid_request')
    expect(bad.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('PaystackProvider: listTransactions', () => {
  const row = (over = {}) => ({ id: 1, reference: PAY_REF, status: 'success', amount: 500000, currency: 'NGN', paid_at: '2026-10-03T10:00:00.000Z', channel: 'card', customer: { email: 'a@b.com' }, metadata: '{"a":1}', ...over })
  const window = { from: '2026-10-03T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' }

  it('normalises a page of successful transactions and reports whether there is another page', async () => {
    const { provider, calls } = make(() => reply(200, { status: true, data: [row(), row({ id: 2, reference: 'cf_pay_zz12cd34_0123456789ab', amount: 100 })], meta: { page: 1, pageCount: 3 } }))
    const r = await provider.listTransactions(window)
    expect(r).toMatchObject({ skipped: 0, page: 1, hasMore: true })
    expect(r.transactions[0]).toMatchObject({ provider: 'paystack', reference: PAY_REF, providerTransactionId: '1', status: 'success', amountKobo: 500000, currency: 'NGN', metadata: { a: 1 } })
    expect(calls[0]).toMatchObject({ path: '/transaction', method: 'GET', query: { from: window.from, to: window.to, status: 'success', page: '1', perPage: '100' } })
    expect((await make(() => reply(200, { status: true, data: [row()], meta: { page: 3, pageCount: 3 } })).provider.listTransactions({ ...window, page: 3 })).hasMore).toBe(false)
  })

  it('skips rows it cannot compare (and says how many) instead of guessing', async () => {
    const { provider } = make(() => reply(200, { status: true, data: [row(), row({ amount: 1.5 }), row({ status: 'weird' }), row({ reference: null }), null], meta: { pageCount: 1 } }))
    const r = await provider.listTransactions(window)
    expect(r.transactions).toHaveLength(1)
    expect(r.skipped).toBe(4)
  })

  it('validates its arguments locally and refuses a malformed reply', async () => {
    const bad = make(() => reply(200, {}))
    for (const args of [{ from: 'yesterday', to: window.to }, { from: window.from }, { ...window, page: 0 }, { ...window, perPage: 500 }]) {
      expect((await bad.provider.listTransactions(args).catch((e) => e)).code).toBe('invalid_request')
    }
    expect(bad.fetchImpl).not.toHaveBeenCalled()
    expect((await make(() => reply(200, { status: true, data: {} })).provider.listTransactions(window).catch((e) => e)).code).toBe('invalid_response')
    expect((await make(() => reply(200, { status: false, message: 'nope' })).provider.listTransactions(window).catch((e) => e)).code).toBe('provider_rejected')
  })
})

describe('PaystackProvider: transfers', () => {
  it('resolves an account, validating the NUBAN locally', async () => {
    const { provider, calls } = make(() => reply(200, { status: true, data: { account_name: 'ADA OBI', account_number: '0123456789' } }))
    expect(await provider.resolveAccount({ accountNumber: '0123456789', bankCode: '058' })).toEqual({ accountName: 'ADA OBI', accountNumber: '0123456789' })
    expect(calls[0]).toMatchObject({ path: '/bank/resolve', query: { account_number: '0123456789', bank_code: '058' } })
    const bad = make(() => reply(200, {}))
    expect((await bad.provider.resolveAccount({ accountNumber: '123', bankCode: '058' }).catch((e) => e)).code).toBe('invalid_request')
    expect(bad.fetchImpl).not.toHaveBeenCalled()
  })

  it('creates a recipient', async () => {
    const { provider, calls } = make(() => reply(200, { status: true, data: { recipient_code: 'RCP_1' } }))
    expect(await provider.createRecipient({ name: 'Ada Obi', accountNumber: '0123456789', bankCode: '058' })).toEqual({ recipientCode: 'RCP_1' })
    expect(calls[0].body).toMatchObject({ type: 'nuban', account_number: '0123456789', bank_code: '058', currency: 'NGN' })
  })

  it('initiates a transfer in integer kobo with the caller\'s reference', async () => {
    const { provider, calls } = make(() => reply(200, { status: true, data: { transfer_code: 'TRF_1', reference: TRF_REF, status: 'otp', amount: 80000 } }))
    const t = await provider.initiateTransfer({ reference: TRF_REF, amountKobo: 80000, recipientCode: 'RCP_1', reason: 'withdrawal' })
    expect(t).toEqual({ transferCode: 'TRF_1', reference: TRF_REF, status: 'pending', amountKobo: 80000 })
    expect(calls[0].body).toMatchObject({ source: 'balance', amount: 80000, recipient: 'RCP_1', reference: TRF_REF, currency: 'NGN' })
  })

  it.each([
    ['uppercase reference', { reference: 'CF_WD_AB12CD34_0123456789AB' }],
    ['too-short reference', { reference: 'cf_wd_short' }],
    ['decimal amount', { amountKobo: 80000.5 }],
    ['no recipient', { recipientCode: '' }],
  ])('rejects a transfer with %s locally', async (_l, over) => {
    const { provider, fetchImpl } = make(() => reply(200, {}))
    const err = await provider.initiateTransfer({ reference: TRF_REF, amountKobo: 80000, recipientCode: 'RCP_1', ...over }).catch((e) => e)
    expect(err.code).toBe('invalid_request')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('NEVER retries a transfer: a 503 or a timeout is reported ambiguous after one attempt', async () => {
    const { provider, fetchImpl } = make(() => reply(503, {}))
    const err = await provider.initiateTransfer({ reference: TRF_REF, amountKobo: 80000, recipientCode: 'RCP_1' }).catch((e) => e)
    expect(err).toMatchObject({ code: 'provider_unavailable', ambiguous: true, retryable: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports a duplicate transfer reference distinctly, so the caller verifies instead of re-sending', async () => {
    const { provider } = make(() => reply(400, { status: false, message: 'Transfer reference already exists - duplicate' }))
    expect((await provider.initiateTransfer({ reference: TRF_REF, amountKobo: 80000, recipientCode: 'RCP_1' }).catch((e) => e)).code).toBe('duplicate_reference')
  })

  it.each([
    ['success', 'success'], ['failed', 'failed'], ['rejected', 'failed'], ['blocked', 'failed'], ['abandoned', 'failed'],
    ['reversed', 'reversed'], ['otp', 'pending'], ['pending', 'pending'], ['received', 'pending'], ['queued', 'pending'], ['whatever', 'unknown'],
  ])('verifyTransfer maps %s to %s (unrecognised is "unknown", never guessed)', async (from, to) => {
    const { provider, calls } = make(() => reply(200, { status: true, data: { transfer_code: 'TRF_1', reference: TRF_REF, status: from, amount: 80000 } }))
    const r = await provider.verifyTransfer({ reference: TRF_REF })
    expect(r).toMatchObject({ status: to, transferCode: 'TRF_1', amountKobo: 80000 })
    expect(calls[0].path).toBe(`/transfer/verify/${TRF_REF}`)
  })

  it('verifyTransfer reports a transfer the provider does not know as not_found (never as failed)', async () => {
    const { provider } = make(() => reply(404, { status: false, message: 'Transfer not found' }))
    expect((await provider.verifyTransfer({ reference: TRF_REF }).catch((e) => e)).code).toBe('not_found')
  })
})

describe('PaystackProvider: getBalance', () => {
  it('returns only the requested currency, not a sum across currencies', async () => {
    const { provider } = make(() => reply(200, { status: true, data: [{ currency: 'NGN', balance: 1500000 }, { currency: 'USD', balance: 9999999 }] }))
    expect((await provider.getBalance()).availableKobo).toBe(1500000)
  })

  it('accepts the available_balance field name used by the existing app code', async () => {
    const { provider } = make(() => reply(200, { status: true, data: [{ currency: 'NGN', available_balance: 42 }] }))
    expect((await provider.getBalance()).availableKobo).toBe(42)
  })

  it('reports zero when there is no balance for the currency, and rejects a malformed balance', async () => {
    expect((await make(() => reply(200, { status: true, data: [{ currency: 'USD', balance: 5 }] })).provider.getBalance()).availableKobo).toBe(0)
    expect((await make(() => reply(200, { status: true, data: [{ currency: 'NGN', balance: 'lots' }] })).provider.getBalance().catch((e) => e)).code).toBe('invalid_response')
  })
})

describe('PaystackProvider: credentials and secrecy', () => {
  it('fails with a config error and sends nothing when the key is missing', async () => {
    const fetchImpl = vi.fn()
    const p = new PaystackProvider({ http: { fetchImpl } })
    const err = await p.verifyPayment({ reference: PAY_REF }).catch((e) => e)
    expect(err.code).toBe('config')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a publishable key without echoing any of it', async () => {
    const fetchImpl = vi.fn()
    const pk = 'pk_live_ZZZZSECRETLOOKINGVALUE12345'
    const p = new PaystackProvider({ secretKey: pk, http: { fetchImpl } })
    const err = await p.verifyPayment({ reference: PAY_REF }).catch((e) => e)
    expect(err.code).toBe('config')
    expect(err.message).toMatch(/publishable/)
    expect(JSON.stringify(err) + err.message).not.toContain('ZZZZ')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads the key lazily from getSecretKey so rotation takes effect', async () => {
    let key = SECRET
    const calls = []
    const p = new PaystackProvider({ getSecretKey: () => key, http: { fetchImpl: async (u, init) => { calls.push(init.headers.Authorization); return reply(200, txn()) } } })
    await p.verifyPayment({ reference: PAY_REF })
    key = 'sk_test_rotatedrotatedrotated99'
    await p.verifyPayment({ reference: PAY_REF })
    expect(calls).toEqual([`Bearer ${SECRET}`, 'Bearer sk_test_rotatedrotatedrotated99'])
  })

  it('never reveals the key through printing, JSON, enumeration, errors or logs', async () => {
    const { provider, logs } = make(() => reply(400, { status: false, message: `rejected for ${SECRET}` }))
    const err = await provider.verifyPayment({ reference: PAY_REF }).catch((e) => e)
    const util = await import('node:util')
    const everything = [
      util.inspect(provider, { depth: 5, showHidden: true }),
      JSON.stringify(provider),
      JSON.stringify(Object.getOwnPropertyNames(provider)),
      JSON.stringify(err), err.message, err.stack,
      JSON.stringify(logs),
    ].join('\n')
    expect(everything).not.toContain(SECRET)
    expect(everything).not.toContain('abcdefghijklmnop')
  })

  it('scrubs a secret echoed in a provider failure delivered as HTTP 200 + status:false', async () => {
    const { provider } = make(() => reply(200, { status: false, message: `no good: ${SECRET}` }))
    const err = await provider.initializePayment({ reference: PAY_REF, amountKobo: 100, email: 'a@b.com' }).catch((e) => e)
    expect(err.message).not.toContain(SECRET)
  })

  it('carries one correlation id through the logs of a retried call', async () => {
    let n = 0
    const { provider, logs } = make(() => (++n === 1 ? reply(503, {}) : reply(200, txn())))
    await provider.verifyPayment({ reference: PAY_REF })
    const ids = new Set(logs.filter(([m]) => m === 'provider.request').map(([, f]) => f.correlationId))
    expect(ids.size).toBe(1)
  })
})
