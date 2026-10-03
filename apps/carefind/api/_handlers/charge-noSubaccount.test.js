// Financial audit C-6: a card charge for a consultation/subscription must settle fully to
// the platform account. The professional/creator is paid through the CareCoin wallet by
// the settle_* RPCs, so a Paystack subaccount split would pay them a second time.
// The handlers build their client at import time, so hand them one stable client whose
// behaviour is swapped per test through `harness.db`.
const harness = vi.hoisted(() => {
  const h = { db: null, paystackFetch: vi.fn(), verifyUser: vi.fn() }
  h.createClient = vi.fn(() => ({ from: (...args) => h.db.from(...args) }))
  return h
})

vi.mock('@supabase/supabase-js', () => ({ createClient: harness.createClient }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: harness.paystackFetch }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: harness.verifyUser }))

import consultation from './charge-consultation.js'
import subscription from './charge-subscription.js'
import createSubaccount from './create-subaccount.js'

function supabaseWith(profileSubaccount) {
  const table = (name) => {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => (
        name === 'professional_consultations'
          ? { data: { fee: 5000, type: 'text' } }
          : { data: { paystack_subaccount_code: profileSubaccount } }
      ),
    }
    return b
  }
  return { from: table }
}

const res = () => {
  const r = { statusCode: 0, body: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}

beforeEach(() => {
  harness.paystackFetch.mockReset()
  harness.paystackFetch.mockResolvedValue({ status: true, data: { authorization_url: 'https://pay.test/x' } })
  harness.verifyUser.mockResolvedValue({ id: 'user-12345678', email: 'u@example.com' })
  harness.db = supabaseWith('ACCT_has_subaccount')
})

describe('charge handlers never split the payment at Paystack', () => {
  it('consultation: no subaccount / transaction_charge even if the professional has a subaccount code', async () => {
    const r = res()
    await consultation({ method: 'POST', body: { professionalId: 'pro-1', callback_url: 'https://app.test/cb' } }, r)
    expect(r.statusCode).toBe(200)
    const sent = JSON.parse(harness.paystackFetch.mock.calls[0][1].body)
    expect(sent.amount).toBe(5000 * 100)
    expect(sent).not.toHaveProperty('subaccount')
    expect(sent).not.toHaveProperty('transaction_charge')
  })

  it('subscription: no subaccount / transaction_charge even if the creator has a subaccount code', async () => {
    const r = res()
    await subscription({ method: 'POST', body: { creatorId: 'creator-1', priceCoins: 5, callback_url: 'https://app.test/cb' } }, r)
    expect(r.statusCode).toBe(200)
    const sent = JSON.parse(harness.paystackFetch.mock.calls[0][1].body)
    expect(sent.amount).toBe(5 * 200 * 100)
    expect(sent).not.toHaveProperty('subaccount')
    expect(sent).not.toHaveProperty('transaction_charge')
  })

  it('create-subaccount is disabled', async () => {
    const r = res()
    await createSubaccount({ method: 'POST', body: { bankCode: '1', accountNumber: '1', accountName: 'x' } }, r)
    expect(r.statusCode).toBe(410)
    expect(harness.paystackFetch).not.toHaveBeenCalled()
  })
})
