// Shop payment service — starts a Paystack payment for an existing shop order.
// The server (api/initiate-shop-payment) owns the amount and the Paystack reference; the client only ever
// sends the order id and follows the URL it is given.

import { supabase } from '../../config/supabaseClient'

export function createShopPaymentService({ supabaseClient = supabase, fetchImpl = (...args) => fetch(...args) } = {}) {
  // Resolves to { url }: the Paystack checkout page for a new attempt, or - when the server finds an earlier
  // attempt was already paid - the order page, which verifies the reference instead of charging twice.
  async function startShopPayment(orderId) {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session) throw new Error('Please sign in again to pay')

    const res = await fetchImpl('/api/initiate-shop-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ order_id: orderId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not start Paystack payment')

    if (data.alreadyPaid && data.reference) {
      return { url: `/orders/${orderId}?reference=${encodeURIComponent(data.reference)}` }
    }
    if (!data.authorization_url) throw new Error('No authorization_url from Paystack')
    return { url: data.authorization_url }
  }

  return { startShopPayment }
}

export const shopPaymentService = createShopPaymentService()
