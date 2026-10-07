import { settleIntentForRequest, createSettlementEffects, ProviderError } from '../index.js'

// Minimal table-backed fake of the supabase query builder.
function fakeSupabase(tables = {}, { users = {} } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  const calls = []
  const from = (table) => {
    const st = { op: 'select', filters: [], row: null }
    const rows = () => (data[table] || []).filter((r) => st.filters.every(([k, v]) => r[k] === v))
    const run = () => {
      calls.push({ table, op: st.op, row: st.row })
      if (st.op === 'insert') { (data[table] ||= []).push({ ...st.row }); return { data: st.row, error: null } }
      return { data: rows(), error: null }
    }
    const b = {
      select: () => b,
      eq: (k, v) => { st.filters.push([k, v]); return b },
      insert: (row) => { st.op = 'insert'; st.row = row; return b },
      update: () => { st.op = 'update'; return b },
      in: () => b,
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  return { from, data, calls, auth: { admin: { getUserById: async (id) => ({ data: { user: users[id] || null } }) } } }
}

const REF = 'ch_plan_ab12cd34_0123456789ab'
const provider = (result) => ({ name: 'paystack', verifyPayment: vi.fn(async () => (result instanceof Error ? Promise.reject(result) : result)) })
const intentRow = (over = {}) => ({ id: 'i1', reference: REF, purpose: 'plan_renewal', business_id: 'b1', status: 'pending', expected_amount: 500000, metadata: {}, ...over })
const ok = { status: 'success', providerTransactionId: '9', amountKobo: 500000, currency: 'NGN' }
const withRpc = (sb, answer) => Object.assign(sb, { rpc: vi.fn(async () => (typeof answer === 'function' ? answer() : { data: answer, error: null })) })

describe('settleIntentForRequest (shared by both apps)', () => {
  const base = (over = {}) => ({ supabase: fakeSupabase({ payment_intents: [intentRow()] }), provider: provider(ok), reference: REF, purpose: 'plan_renewal', ...over })

  it('needs a reference', async () => {
    expect(await settleIntentForRequest(base({ reference: '' }))).toMatchObject({ http: 400, outcome: 'invalid' })
    expect(await settleIntentForRequest(base({ reference: { $ne: null } }))).toMatchObject({ http: 400 })
  })

  it('404s an unknown reference without asking the provider', async () => {
    const p = provider(ok)
    const out = await settleIntentForRequest(base({ reference: 'nope_nope_nope', provider: p }))
    expect(out).toMatchObject({ http: 404, outcome: 'unknown_reference' })
    expect(p.verifyPayment).not.toHaveBeenCalled()
  })

  it('refuses a reference of another purpose, before the provider and before the engine', async () => {
    const p = provider(ok)
    const sb = withRpc(fakeSupabase({ payment_intents: [intentRow({ purpose: 'booking' })] }), { outcome: 'settled' })
    const out = await settleIntentForRequest(base({ supabase: sb, provider: p }))
    expect(out).toMatchObject({ http: 400, outcome: 'wrong_purpose' })
    expect(p.verifyPayment).not.toHaveBeenCalled()
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it("applies the app's own ownership rule (authorize) before anything else", async () => {
    const p = provider(ok)
    const sb = withRpc(fakeSupabase({ payment_intents: [intentRow({ business_id: 'someone-else' })] }), { outcome: 'settled' })
    const out = await settleIntentForRequest(base({ supabase: sb, provider: p, authorize: (i) => i.business_id === 'b1' }))
    expect(out).toMatchObject({ http: 403, outcome: 'forbidden' })
    expect(p.verifyPayment).not.toHaveBeenCalled()
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it.each([
    [{ outcome: 'settled', purpose: 'plan_renewal', payment_id: 'p1' }, 200, 'settled'],
    [{ outcome: 'needs_refund', reason: 'amount_mismatch' }, 409, 'needs_refund'],
    [{ outcome: 'rejected', reason: 'transaction_id_conflict' }, 500, 'rejected'],
  ])('maps the engine answer %j to HTTP %i', async (engine, http, outcome) => {
    const sb = withRpc(fakeSupabase({ payment_intents: [intentRow()] }), engine)
    const out = await settleIntentForRequest(base({ supabase: sb }))
    expect(out).toMatchObject({ http, outcome })
    if (http === 409) expect(out.body).toMatchObject({ needsRefund: true, reason: 'amount_mismatch' })
    if (http === 200) expect(out.result.payment_id).toBe('p1')
  })

  it('answers a settled intent as alreadyProcessed without contacting the provider', async () => {
    const p = provider(ok)
    const out = await settleIntentForRequest(base({ supabase: fakeSupabase({ payment_intents: [intentRow({ status: 'settled' })] }), provider: p }))
    expect(out).toMatchObject({ http: 200, outcome: 'already_settled', body: { alreadyProcessed: true } })
    expect(p.verifyPayment).not.toHaveBeenCalled()
  })

  it('reports a payment Paystack does not call successful as 400 and never reaches the engine', async () => {
    const sb = withRpc(fakeSupabase({ payment_intents: [intentRow()] }), { outcome: 'settled' })
    const out = await settleIntentForRequest(base({ supabase: sb, provider: provider({ ...ok, status: 'abandoned' }) }))
    expect(out).toMatchObject({ http: 400, outcome: 'not_paid' })
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('answers 502 for a provider failure and 500 for anything else, never exposing the error text', async () => {
    const err = new ProviderError({ code: 'timeout', message: 'Bearer sk_test_SECRETSECRET timed out' })
    const logged = []
    const a = await settleIntentForRequest(base({ provider: provider(err), logger: { error: (m, f) => logged.push(f), info() {}, warn() {} } }))
    expect(a.http).toBe(502)
    expect(JSON.stringify(a.body)).not.toContain('SECRET')
    const b = await settleIntentForRequest(base({ provider: provider(new Error('db exploded')) }))
    expect(b.http).toBe(500)
    expect(JSON.stringify(b.body)).not.toContain('exploded')
  })
})

describe('createSettlementEffects (shared by both apps)', () => {
  const setup = (tables = {}, users = {}, send) => {
    const sent = []
    const sb = fakeSupabase(tables, { users })
    const run = createSettlementEffects({ supabase: sb, send: send || (async (m) => { sent.push(m) }), logger: { error: vi.fn() } })
    return { sb, run, sent }
  }
  const settled = (purpose, intent) => ({ outcome: 'settled', purpose, intent })

  it.each(['already_settled', 'needs_refund', 'not_paid', 'rejected', 'unknown_reference'])('does nothing for outcome %s', async (outcome) => {
    const { run, sent, sb } = setup({}, {})
    await run({ outcome, purpose: 'wallet_topup', intent: { customer_id: 'u1', reference: REF, expected_amount: 100 } })
    expect(sent).toEqual([])
    expect(sb.calls).toEqual([])
  })

  it('ignores a purpose it has no effect for', async () => {
    const { run, sent } = setup()
    await run(settled('some_future_purpose', intentRow({ purpose: 'some_future_purpose' })))
    expect(sent).toEqual([])
  })

  it('top-up: one payment_success email to the payer, keyed by the reference', async () => {
    const { run, sent } = setup({}, { u1: { email: 'a@b.com', user_metadata: { full_name: 'Ada' } } })
    await run(settled('wallet_topup', { customer_id: 'u1', reference: REF, expected_amount: 95000 }))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ templateKey: 'payment_success', toEmail: 'a@b.com', idempotencyKey: `payment-success:${REF}` })
    expect(sent[0].payload.fullName).toBe('Ada')
  })

  it('plan renewal: emails the owner (owner_email, else the business email) with the plan and expiry; no email when there is none', async () => {
    const biz = { id: 'b1', name: 'Clinic', plan: 'growth', plan_expires_at: '2026-12-01T00:00:00Z', owner_name: 'Dr Obi', owner_email: 'owner@x.com', email: 'biz@x.com' }
    const a = setup({ businesses: [biz] })
    await a.run(settled('plan_renewal', intentRow()))
    expect(a.sent).toHaveLength(1)
    expect(a.sent[0]).toMatchObject({ templateKey: 'subscription_created', toEmail: 'owner@x.com', idempotencyKey: `subscription-started:${REF}` })
    expect(a.sent[0].payload).toMatchObject({ fullName: 'Dr Obi', plan: 'growth', businessName: 'Clinic' })

    const b = setup({ businesses: [{ ...biz, owner_email: null }] })
    await b.run(settled('plan_renewal', intentRow()))
    expect(b.sent[0].toEmail).toBe('biz@x.com')

    const c = setup({ businesses: [{ ...biz, owner_email: null, email: null }] })
    await c.run(settled('plan_renewal', intentRow()))
    expect(c.sent).toEqual([])
  })

  const appt = (over = {}) => ({ id: 'a1', business_id: 'b1', client_name: 'Ada', date: '2026-10-10', time: '10:00', fee_amount: 150050, client_email: 'ada@x.com', client_id: null, service: 'Consult', source: 'carefind', ...over })

  it('a CareFind booking: notifies the business and sends booking_confirmed', async () => {
    const { run, sent, sb } = setup({ appointments: [appt()], businesses: [{ id: 'b1', name: 'Clinic' }], staff_notifications: [] })
    await run(settled('booking', { entity_id: 'a1' }))
    expect(sb.data.staff_notifications).toHaveLength(1)
    expect(sb.data.staff_notifications[0]).toMatchObject({ business_id: 'b1', kind: 'booking_paid', is_owner: true })
    expect(sent[0]).toMatchObject({ templateKey: 'booking_confirmed', toEmail: 'ada@x.com', idempotencyKey: 'booking-confirmed:a1' })
  })

  it('a CareHub appointment: appointment_confirmed with a staffName, and the client email falls back to the client record', async () => {
    const { run, sent } = setup({ appointments: [appt({ source: 'carehub', client_email: null, client_id: 'c1' })], businesses: [{ id: 'b1', name: 'Clinic' }], clients: [{ id: 'c1', email: 'fromclient@x.com' }], staff_notifications: [] })
    await run(settled('appointment', { entity_id: 'a1' }))
    expect(sent[0]).toMatchObject({ templateKey: 'appointment_confirmed', toEmail: 'fromclient@x.com', idempotencyKey: 'appointment-confirmed:a1' })
    expect(sent[0].payload).toHaveProperty('staffName', '')
  })

  it('a booking with no client email still notifies the business and sends nothing', async () => {
    const { run, sent, sb } = setup({ appointments: [appt({ client_email: null })], businesses: [{ id: 'b1', name: 'C' }], staff_notifications: [] })
    await run(settled('booking', { entity_id: 'a1' }))
    expect(sb.data.staff_notifications).toHaveLength(1)
    expect(sent).toEqual([])
  })

  describe('shop_order', () => {
    const shopResult = { outcome: 'settled', purpose: 'shop_order', order_id: 'o1', order_ref: 'CF-1', vendor_business_id: 'b1', total_kobo: 2500000, intent: { reference: 'cf_shop_1' } }
    const order = (over = {}) => ({ id: 'o1', order_ref: 'CF-1', total_kobo: 2500000, delivery_address: '1 Main St', delivery_email: 'buyer@x.com', customer_name: 'Ada', ...over })

    it('notifies the vendor and sends the order confirmation once, keyed by the order', async () => {
      const { run, sent, sb } = setup({ shop_orders: [order()], shop_order_items: [], staff_notifications: [] })
      await run(shopResult)
      expect(sb.data.staff_notifications[0]).toMatchObject({ business_id: 'b1', kind: 'shop_order_paid', is_owner: true, link: '/dashboard/ecommerce/orders/o1' })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ templateKey: 'order_confirmation', toEmail: 'buyer@x.com', idempotencyKey: 'order-confirmation:o1' })
      expect(sent[0].payload).toMatchObject({ orderRef: 'CF-1', totalNaira: 25000, fullName: 'Ada' })
    })

    it('an order with no usable delivery email still notifies the vendor and sends nothing', async () => {
      const { run, sent, sb } = setup({ shop_orders: [order({ delivery_email: null })], staff_notifications: [] })
      await run(shopResult)
      expect(sb.data.staff_notifications).toHaveLength(1)
      expect(sent).toEqual([])
    })

    it('one failing step never blocks the others and nothing throws (no rpc, a failing email)', async () => {
      const logger = { error: vi.fn() }
      const sb = fakeSupabase({ shop_orders: [order()], staff_notifications: [] })
      const run = createSettlementEffects({ supabase: sb, send: async () => { throw new Error('smtp down') }, logger })
      await expect(run(shopResult)).resolves.toBeUndefined()
      expect(sb.data.staff_notifications).toHaveLength(1)
      expect(logger.error).toHaveBeenCalled()
    })

    it('does nothing for a shop payment that was not settled by this call', async () => {
      const { run, sent, sb } = setup({ shop_orders: [order()] })
      await run({ ...shopResult, outcome: 'already_settled' })
      expect(sent).toEqual([])
      expect(sb.calls).toEqual([])
    })
  })

  it('an email failure never breaks the caller (it is logged, the settlement stands)', async () => {
    const { run } = setup({ businesses: [{ id: 'b1', name: 'C', owner_email: 'o@x.com' }] }, {}, async () => { throw new Error('smtp down') })
    await expect(run(settled('plan_renewal', intentRow()))).resolves.toBeUndefined()
  })

  it('an unexpected error inside an effect is swallowed too', async () => {
    const sb = fakeSupabase({})
    sb.from = () => { throw new Error('db gone') }
    const run = createSettlementEffects({ supabase: sb, send: async () => {}, logger: { error: vi.fn() } })
    await expect(run(settled('plan_renewal', intentRow()))).resolves.toBeUndefined()
  })
})
