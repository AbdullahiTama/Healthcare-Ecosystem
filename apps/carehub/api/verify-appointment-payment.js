import { createClient } from '@supabase/supabase-js'
import { verifyBusiness } from './_lib/verifyBusiness.js'
import { paystackFetch } from './_lib/paystack.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { business, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const { reference } = req.body || {}
  if (!reference) return res.status(400).json({ error: 'Missing reference' })

  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('id, business_id, client_name, booking_type, date, time, fee_amount, payment_status')
    .eq('payment_reference', reference)
    .eq('business_id', business.id)
    .maybeSingle()
  if (apptErr || !appt) return res.status(404).json({ error: 'No appointment found for this reference' })
  if (appt.payment_status === 'paid') return res.status(200).json({ success: true, id: appt.id, alreadyPaid: true })

  let paystackData
  try {
    paystackData = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not verify payment' })
  }
  if (!paystackData.status || paystackData.data?.status !== 'success') {
    return res.status(400).json({ error: 'Payment not confirmed by Paystack' })
  }

  const verifiedAmount = paystackData.data.amount
  if (verifiedAmount !== appt.fee_amount) {
    return res.status(400).json({ error: 'Payment amount does not match the appointment fee' })
  }

  const { data: settleResult, error: settleError } = await supabase.rpc('settle_card_booking', {
    p_appointment_id: appt.id,
    p_reference: reference,
  })
  if (settleError) return res.status(500).json({ error: settleError.message })
  if (settleResult !== 'ok' && settleResult !== 'already_paid') {
    return res.status(400).json({ error: settleResult || 'Could not settle payment' })
  }

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

  return res.status(200).json({ success: true, id: appt.id, paid: true })
}