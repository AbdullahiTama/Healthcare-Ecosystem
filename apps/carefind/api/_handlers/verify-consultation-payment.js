import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { settleIntentForRequest } from '../_lib/intentSettlement.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'

// Called when the user is redirected back from Paystack after booking a consultation by card. Booking
// and professional credit happen in settle_payment_intent(), the same function the webhook uses, so
// whichever arrives first settles and the other is a no-op.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const { reference } = req.body || {}
  const out = await settleIntentForRequest({ supabase, reference, purpose: 'consultation', user })

  if (out.outcome === 'already_settled') {
    return res.status(200).json({ success: true, alreadyProcessed: true, alreadyBooked: false })
  }
  // The patient already had a booking: they keep it, the card payment is queued for refund.
  if (out.outcome === 'needs_refund' && out.result?.reason === 'already_booked') {
    return res.status(200).json({ success: true, alreadyBooked: true, alreadyProcessed: false, needsRefund: true })
  }
  if (out.outcome !== 'settled') return res.status(out.http).json(out.body)

  // Email must not gate or fail the verified settlement. The outbox retries asynchronously.
  try {
    if (user.email) {
      await enqueueOutbox({
        templateKey: 'consultation_confirmed',
        toEmail: user.email,
        payload: { fullName: user.user_metadata?.full_name || user.email, service: 'Consultation' },
        subject: 'Your CareFind consultation is confirmed',
        idempotencyKey: `consultation-confirmed:${reference}`,
      })
      flushOutbox().catch((err) => console.error('[verify-consultation-payment] outbox flush error:', err))
    }
  } catch (err) {
    console.error('[verify-consultation-payment] email enqueue error:', err)
  }

  return res.status(200).json({ success: true, alreadyProcessed: false, alreadyBooked: false })
}
