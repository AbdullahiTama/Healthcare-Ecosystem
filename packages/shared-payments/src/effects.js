// What happens AFTER a payment has been settled: confirmation emails and the business's in-app notice, for
// every purpose of both apps. Only the call that actually settled the intent gets outcome 'settled' - the
// redirect handler and the webhook both route here, and whichever loses the race sees 'already_settled'
// and does nothing, so the effects run exactly once. Nothing here moves money and nothing here may fail a
// settlement: every effect is best-effort and swallows its own errors.
//
// The app supplies `send(message)` (enqueue the email and flush the outbox with ITS email service), so this
// module depends on neither app's email wiring.

/**
 * @param {object} deps
 * @param {object} deps.supabase                       service-role client
 * @param {(message: object) => Promise<void>} deps.send   enqueue + flush one email; may throw
 * @param {{error: Function}} [deps.logger]
 * @returns {(result: {outcome: string, purpose?: string, intent?: object}) => Promise<void>}
 */
export function createSettlementEffects({ supabase, send, logger = { error() {} } }) {
  async function emailOf(userId) {
    try {
      const { data } = await supabase.auth.admin.getUserById(userId)
      return data?.user || null
    } catch {
      return null
    }
  }
  async function safeSend(message) {
    try {
      await send(message)
    } catch (err) {
      logger.error('settlement.email.failed', { template: message.templateKey, message: err.message })
    }
  }

  const effects = {
    async wallet_topup({ intent }) {
      const user = await emailOf(intent.customer_id)
      if (!user?.email) return
      await safeSend({
        templateKey: 'payment_success',
        toEmail: user.email,
        payload: {
          fullName: user.user_metadata?.full_name || user.email,
          amount: (intent.expected_amount / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' }),
          reference: intent.reference,
          purpose: 'CareCoin top-up',
        },
        subject: 'CareFind: payment received',
        idempotencyKey: `payment-success:${intent.reference}`,
      })
    },

    async creator_subscription({ intent }) {
      const user = await emailOf(intent.customer_id)
      if (!user?.email) return
      const { data: creator } = await supabase.from('profiles').select('display_name, full_name').eq('id', intent.entity_id).maybeSingle()
      const { data: subscriber } = await supabase.from('profiles').select('full_name').eq('id', intent.customer_id).maybeSingle()
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      await safeSend({
        templateKey: 'subscription_created',
        toEmail: user.email,
        payload: {
          fullName: subscriber?.full_name || 'There',
          plan: `${Number(intent.metadata?.coins)} CareCoins`,
          businessName: creator?.display_name || creator?.full_name || 'Creator',
          expiryDate: expiresAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        },
        subject: `You're subscribed - ${creator?.display_name || 'your subscription'} is active`,
        idempotencyKey: `subscription-started:${intent.reference}`,
      })
    },

    async consultation({ intent }) {
      const user = await emailOf(intent.customer_id)
      if (!user?.email) return
      await safeSend({
        templateKey: 'consultation_confirmed',
        toEmail: user.email,
        payload: { fullName: user.user_metadata?.full_name || user.email, service: 'Consultation' },
        subject: 'Your CareFind consultation is confirmed',
        idempotencyKey: `consultation-confirmed:${intent.reference}`,
      })
    },

    // A CareFind booking and a CareHub appointment: tell the business, confirm to the client.
    async booking({ intent }) {
      const { data: appt } = await supabase
        .from('appointments')
        .select('id, business_id, client_name, date, time, fee_amount, client_email, client_id, service, source')
        .eq('id', intent.entity_id)
        .maybeSingle()
      if (!appt) return

      await supabase.from('staff_notifications').insert({
        business_id: appt.business_id,
        staff_id: null,
        is_owner: true,
        kind: 'booking_paid',
        title: `Payment received — ${appt.client_name}`,
        body: `${appt.date} at ${appt.time} — ₦${(appt.fee_amount / 100).toLocaleString()}`,
        link: '/dashboard/appointments',
        read_at: null,
      })

      let clientEmail = appt.client_email
      if (!clientEmail && appt.client_id) {
        const { data: client } = await supabase.from('clients').select('email').eq('id', appt.client_id).maybeSingle()
        clientEmail = client?.email || null
      }
      if (!clientEmail || !clientEmail.includes('@')) return

      const { data: business } = await supabase.from('businesses').select('name').eq('id', appt.business_id).maybeSingle()
      const isCareHub = appt.source === 'carehub'
      await safeSend({
        templateKey: isCareHub ? 'appointment_confirmed' : 'booking_confirmed',
        toEmail: clientEmail,
        payload: {
          fullName: appt.client_name,
          businessName: business?.name || '',
          service: appt.service || 'Consultation',
          date: appt.date,
          time: appt.time,
          ...(isCareHub ? { staffName: '' } : {}),
        },
        subject: isCareHub ? 'Your appointment is confirmed' : 'Your booking is confirmed',
        sourceId: appt.id,
        idempotencyKey: `${isCareHub ? 'appointment-confirmed' : 'booking-confirmed'}:${appt.id}`,
      })
    },

    async plan_renewal({ intent }) {
      const { data: biz } = await supabase
        .from('businesses')
        .select('name, plan, plan_expires_at, owner_name, owner_email, email')
        .eq('id', intent.business_id)
        .maybeSingle()
      const ownerEmail = biz?.owner_email || biz?.email
      if (!biz || !ownerEmail) return
      await safeSend({
        templateKey: 'subscription_created',
        toEmail: ownerEmail,
        payload: {
          fullName: biz.owner_name || 'Business Owner',
          plan: biz.plan || 'Standard',
          businessName: biz.name,
          expiryDate: biz.plan_expires_at ? new Date(biz.plan_expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        },
        subject: 'Your CareHub subscription is active',
        idempotencyKey: `subscription-started:${intent.reference}`,
      })
    },

    // A paid shop order: tell the vendor, record the purchase pattern, confirm to the customer. Every step is best-effort
    // and independent: one failing never blocks the others (and nothing here can fail the settlement).
    async shop_order({ order_id, order_ref, vendor_business_id, total_kobo }) {
      const step = async (name, fn) => {
        try { await fn() } catch (err) { logger.error('settlement.effects.step_failed', { purpose: 'shop_order', step: name, message: err.message }) }
      }
      await step('vendor_notice', async () => {
        await supabase.from('staff_notifications').insert({
          business_id: vendor_business_id,
          staff_id: null,
          is_owner: true,
          kind: 'shop_order_paid',
          title: `Shop order paid - ${order_ref}`,
          body: `Order ${order_ref} - ${'\u20a6'}${(total_kobo / 100).toLocaleString()} via Paystack`,
          link: `/dashboard/ecommerce/orders/${order_id}`,
          read_at: null,
        })
      })
      await step('purchase_pattern', async () => { await supabase.rpc('track_purchase_pattern', { p_order_id: order_id }) })
      await step('customer_email', async () => {
        const { data: order } = await supabase
          .from('shop_orders')
          .select('id, order_ref, total_kobo, delivery_address, delivery_email, customer_name')
          .eq('id', order_id)
          .maybeSingle()
        const email = order?.delivery_email
        if (!order || !email || !email.includes('@')) return
        const { data: items } = await supabase.from('shop_order_items').select('product_name, quantity, unit_price_kobo').eq('order_id', order_id)
        await safeSend({
          templateKey: 'order_confirmation',
          toEmail: email,
          payload: {
            fullName: order.customer_name || 'Valued Customer',
            orderId: order.id,
            orderRef: order.order_ref,
            items: (items || []).map((it) => ({ name: it.product_name, quantity: it.quantity, price: Math.round((it.unit_price_kobo || 0) / 100) })),
            totalNaira: Math.round((order.total_kobo || 0) / 100),
            businessName: 'CareFind',
            deliveryAddress: order.delivery_address || '',
          },
          subject: `Order Confirmed - ${order.order_ref}`,
          idempotencyKey: `order-confirmation:${order.id}`,
        })
      })
    },
  }
  effects.appointment = effects.booking

  return async function runSettlementEffects(result) {
    if (result?.outcome !== 'settled') return
    const run = effects[result.purpose]
    if (!run) return
    try {
      await run(result)
    } catch (err) {
      logger.error('settlement.effects.failed', { purpose: result.purpose, message: err.message })
    }
  }
}
