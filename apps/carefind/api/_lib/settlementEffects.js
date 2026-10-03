import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

// What happens AFTER a payment has been settled (confirmation emails, the business's in-app notice).
// Only the call that actually settled the intent gets outcome 'settled' - the redirect handler and the
// webhook both route here, and whichever loses the race sees 'already_settled' and does nothing, so
// the side effects run exactly once. Nothing here moves money and nothing here may fail a settlement:
// every effect is best-effort and swallows its own errors.

async function emailOf(supabase, userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    return data?.user || null
  } catch {
    return null
  }
}

async function send(message) {
  try {
    await enqueueOutbox(message)
    flushOutbox().catch((err) => console.error('[settlementEffects] outbox flush error:', err))
  } catch (err) {
    console.error('[settlementEffects] email enqueue error:', err)
  }
}

const effects = {
  async wallet_topup(supabase, { intent }) {
    const user = await emailOf(supabase, intent.customer_id)
    if (!user?.email) return
    await send({
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

  async creator_subscription(supabase, { intent }) {
    const user = await emailOf(supabase, intent.customer_id)
    if (!user?.email) return
    const { data: creator } = await supabase.from('profiles').select('display_name, full_name').eq('id', intent.entity_id).maybeSingle()
    const { data: subscriber } = await supabase.from('profiles').select('full_name').eq('id', intent.customer_id).maybeSingle()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await send({
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

  async consultation(supabase, { intent }) {
    const user = await emailOf(supabase, intent.customer_id)
    if (!user?.email) return
    await send({
      templateKey: 'consultation_confirmed',
      toEmail: user.email,
      payload: { fullName: user.user_metadata?.full_name || user.email, service: 'Consultation' },
      subject: 'Your CareFind consultation is confirmed',
      idempotencyKey: `consultation-confirmed:${intent.reference}`,
    })
  },

  async booking(supabase, { intent }) {
    const { data: appt } = await supabase
      .from('appointments')
      .select('id, business_id, client_name, date, time, fee_amount, client_email, service')
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

    if (appt.client_email && appt.client_email.includes('@')) {
      const { data: business } = await supabase.from('businesses').select('name').eq('id', appt.business_id).maybeSingle()
      await send({
        templateKey: 'booking_confirmed',
        toEmail: appt.client_email,
        payload: {
          fullName: appt.client_name,
          businessName: business?.name || '',
          service: appt.service || 'Consultation',
          date: appt.date,
          time: appt.time,
        },
        subject: 'Your booking is confirmed',
        sourceId: appt.id,
        idempotencyKey: `booking-confirmed:${appt.id}`,
      })
    }
  },
}

/** @param {{outcome:string, purpose?:string, intent?:object}} result the settleByReference result */
export async function runSettlementEffects(supabase, result) {
  if (result?.outcome !== 'settled') return
  const run = effects[result.purpose]
  if (!run) return
  try {
    await run(supabase, result)
  } catch (err) {
    console.error(`[settlementEffects] ${result.purpose} effects failed:`, err)
  }
}
