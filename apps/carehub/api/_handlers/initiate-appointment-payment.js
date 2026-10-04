import { createPaymentIntent, markIntentPending, markIntentFailed, newReference } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'

// Starts a card payment for one of the verified business's own appointments. The FEE is the one stored on
// the appointment (never from the body). Every attempt records its own payment intent with a fresh
// reference - Paystack refuses to initialise the same reference twice, so reusing one broke retries after an
// abandoned attempt - and the appointment points at the latest reference.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { appointment_id: appointmentId } = req.body || {}
  if (typeof appointmentId !== 'string' || !appointmentId) return res.status(400).json({ error: 'Missing appointment id' })

  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('id, business_id, fee_amount, payment_status')
    .eq('id', appointmentId)
    .eq('business_id', business.id)
    .maybeSingle()
  if (apptErr || !appt) return res.status(404).json({ error: 'Appointment not found' })
  if (appt.payment_status === 'paid') return res.status(400).json({ error: 'Already paid' })
  if (!Number.isSafeInteger(appt.fee_amount) || appt.fee_amount <= 0) return res.status(400).json({ error: 'No fee set for this appointment' })

  const reference = newReference('ch_appt', appt.id)
  let intent
  try {
    intent = await createPaymentIntent(supabase, {
      reference,
      application: 'carehub',
      purpose: 'appointment',
      businessId: business.id,
      entityType: 'appointment',
      entityId: appt.id,
      expectedAmountKobo: appt.fee_amount,
      metadata: { source: 'carehub' },
    })
  } catch (err) {
    paymentLogger.error('payment.intent.create_failed', { purpose: 'appointment', code: err.code, message: err.message })
    return res.status(500).json({ error: 'Could not start payment' })
  }

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || ''
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const origin = host ? `${proto}://${host}` : ''
    const init = await getPaystackProvider().initializePayment({
      reference,
      amountKobo: intent.expected_amount,
      email: `booking+${appt.id}@carehub.ng`,
      callbackUrl: `${origin}/dashboard/appointments?reference=${reference}`,
      metadata: { intent_id: intent.id, purpose: 'appointment', source: 'carehub' },
    })
    await markIntentPending(supabase, intent.id)
    // The appointment now points at the latest attempt (earlier attempts stay settleable: their intents remain).
    await supabase.from('appointments').update({ payment_reference: reference }).eq('id', appt.id)
    return res.status(200).json({ authorization_url: init.authorizationUrl, reference, fee: appt.fee_amount })
  } catch (err) {
    if (!err.ambiguous) await markIntentFailed(supabase, intent.id).catch(() => {})
    return res.status(err.code === 'config' ? 500 : 502).json({ error: err.message || 'Could not start payment' })
  }
}
