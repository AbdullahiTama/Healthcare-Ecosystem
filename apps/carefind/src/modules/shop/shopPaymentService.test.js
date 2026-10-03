import { createShopPaymentService } from './shopPaymentService'

const signedIn = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }
const signedOut = { auth: { getSession: async () => ({ data: { session: null } }) } }
const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body })

describe('startShopPayment', () => {
  it('returns the Paystack checkout URL for a new payment attempt', async () => {
    const calls = []
    const svc = createShopPaymentService({
      supabaseClient: signedIn,
      fetchImpl: async (url, init) => { calls.push([url, init]); return reply(200, { authorization_url: 'https://checkout.paystack.com/x', reference: 'CF-1' })() },
    })

    const result = await svc.startShopPayment('order-1')

    expect(result).toEqual({ url: 'https://checkout.paystack.com/x' })
    expect(calls[0][0]).toBe('/api/initiate-shop-payment')
    expect(calls[0][1].headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(calls[0][1].body)).toEqual({ order_id: 'order-1' })
  })

  it('sends the customer to the order page to confirm an earlier attempt that was already paid', async () => {
    const svc = createShopPaymentService({ supabaseClient: signedIn, fetchImpl: reply(200, { alreadyPaid: true, reference: 'CF-OLD 1' }) })

    const result = await svc.startShopPayment('order-1')

    expect(result).toEqual({ url: '/orders/order-1?reference=CF-OLD%201' })
  })

  it('refuses to start without a session', async () => {
    const svc = createShopPaymentService({ supabaseClient: signedOut, fetchImpl: reply(200, {}) })

    await expect(svc.startShopPayment('order-1')).rejects.toThrow('Please sign in again to pay')
  })

  it('surfaces the server error message', async () => {
    const svc = createShopPaymentService({ supabaseClient: signedIn, fetchImpl: reply(502, { error: 'Could not check your earlier payment. Please try again in a moment.' }) })

    await expect(svc.startShopPayment('order-1')).rejects.toThrow('Could not check your earlier payment')
  })

  it('fails clearly when Paystack returns no checkout URL', async () => {
    const svc = createShopPaymentService({ supabaseClient: signedIn, fetchImpl: reply(200, {}) })

    await expect(svc.startShopPayment('order-1')).rejects.toThrow('No authorization_url from Paystack')
  })
})
