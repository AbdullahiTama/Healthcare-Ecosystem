// A wallet-funded purpose (booking_wallet, subscription_wallet ...) has no provider payment. If one reached the redirect or
// webhook path, asking Paystack would answer "not found" and the engine would wrongly close the intent as failed. The
// provider path must refuse to touch it.
import { describe, it, expect, vi } from 'vitest'
import { settleByReference } from '../settlement.js'
import { settleIntentForRequest } from '../requestSettlement.js'
import { createFakeSupabase } from '../testing.js'

const WALLET_PURPOSES = ['booking_wallet', 'subscription_wallet', 'consultation_wallet', 'shop_order_wallet', 'plan_renewal_wallet', 'appointment_fee_wallet']

const setup = (purpose) => {
  const db = createFakeSupabase({ tables: { payment_intents: [{ id: 'i1', reference: 'ref_wallet_1', purpose, status: 'pending', provider: 'paystack', expected_amount: 100, currency: 'NGN', customer_id: 'u1' }] } })
  const provider = { name: 'paystack', verifyPayment: vi.fn(async () => { const e = new Error('not found'); e.code = 'not_found'; throw e }) }
  return { db, provider }
}

describe.each(WALLET_PURPOSES)('%s', (purpose) => {
  it('is never sent to the provider and its intent is left exactly as it was', async () => {
    const { db, provider } = setup(purpose)
    const r = await settleByReference({ supabase: db, provider, reference: 'ref_wallet_1' })
    expect(r).toMatchObject({ outcome: 'not_provider_payment', purpose })
    expect(provider.verifyPayment).not.toHaveBeenCalled()
    expect(db.data.payment_intents[0].status).toBe('pending')
  })

  it('answers the redirect handler with a clear 400, not a failure of the payment', async () => {
    const { db, provider } = setup(purpose)
    const out = await settleIntentForRequest({ supabase: db, provider, reference: 'ref_wallet_1', purpose })
    expect(out).toMatchObject({ http: 400, outcome: 'not_provider_payment' })
    expect(db.data.payment_intents[0].status).toBe('pending')
  })
})

describe('card purposes are unaffected', () => {
  it('a wallet_topup intent still goes to the provider', async () => {
    const { db } = setup('wallet_topup')
    const provider = { name: 'paystack', verifyPayment: vi.fn(async () => ({ status: 'pending' })) }
    await settleByReference({ supabase: db, provider, reference: 'ref_wallet_1' })
    expect(provider.verifyPayment).toHaveBeenCalledTimes(1)
  })
})
