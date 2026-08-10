import { createClient } from '@supabase/supabase-js'
import { paystackFetch } from './_lib/paystack.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Verifies a Paystack payment for a consultation booking and marks the
// appointment as paid. Called when the client is redirected back from Paystack
// (so the dashboard updates immediately) — the paystack-webhook.js handler is
// the async backup.
//
// Nothing is trusted from the client except which reference to look up. The
// amount, appointment, and owning business all come from Paystack's verify
// response, cross-checked against the stored appointment.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { reference } = req.body || {}
  if (!reference) return res.status(400).json({ error: 'Missing reference' })

  // Find the appointment by its stored payment reference first — this is the
  // lookup key the client is allowed to supply.
  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('id, business_id, client_name, booking_type, date, time, fee_amount, payment_status')
    .eq('payment_reference', reference)
    .maybeSingle()
  if (apptErr || !appt) return res.status(404).json({ error: 'No booking found for this reference' })
  if (appt.payment_status === 'paid') {
    return res.status(200).json({ success: true, id: appt.id, alreadyPaid: true })
  }

  // Verify with Paystack — the source of truth for whether money moved.
  let paystackData
  try {
    paystackData = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not verify payment' })
  }
  if (!paystackData.status || paystackData.data?.status !== 'success') {
    return res.status(400).json({ error: 'Payment not confirmed by Paystack' })
  }

  // Cross-check: the verified amount must match the stored fee.
  const verifiedAmount = paystackData.data.amount
  if (verifiedAmount !== appt.fee_amount) {
    return res.status(400).json({ error: 'Payment amount does not match the booking fee' })
  }

  // Mark paid.
  await supabase
    .from('appointments')
    .update({ payment_status: 'paid' })
    .eq('id', appt.id)

  // Notify the business that payment landed.
  await supabase.from('staff_notifications').insert({
    business_id: appt.business_id,
    staff_id: null,
    is_owner: true,
    kind: 'booking_paid',
    title: `Payment received — ${appt.client_name}`,
    body: `${appt.date} at ${appt.time} · ₦${(appt.fee_amount / 100).toLocaleString()}`,
    link: '/dashboard/appointments',
    read_at: null,
  })

  return res.status(200).json({ success: true, id: appt.id, paid: true })
}
