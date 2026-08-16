import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
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

  const { appointment_id: appointmentId } = req.body || {}
  if (!appointmentId) return res.status(400).json({ error: 'Missing appointment id' })

  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('id, business_id, client_name, phone, booking_type, date, time, fee_amount, payment_status, payment_reference')
    .eq('id', appointmentId)
    .eq('business_id', business.id)
    .maybeSingle()
  if (apptErr || !appt) return res.status(404).json({ error: 'Appointment not found' })
  if (appt.payment_status === 'paid') return res.status(400).json({ error: 'Already paid' })
  if (!appt.fee_amount || appt.fee_amount <= 0) return res.status(400).json({ error: 'No fee set for this appointment' })

  const reference = appt.payment_reference || `appt_${appt.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`
  if (!appt.payment_reference) {
    await supabase.from('appointments').update({ payment_reference: reference }).eq('id', appt.id)
  }

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || ''
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const origin = host ? `${proto}://${host}` : ''
    const data = await paystackFetch('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: appt.phone ? `booking+${appt.id}@carehub.ng` : `booking+${appt.id}@carehub.ng`,
        amount: appt.fee_amount,
        reference,
        currency: 'NGN',
        callback_url: `${origin}/dashboard/appointments?reference=${reference}`,
        metadata: { appointment_id: appt.id, business_id: business.id, source: 'carehub' },
      }),
    })
    if (!data.status) return res.status(400).json({ error: data.message || 'Could not start payment' })
    return res.status(200).json({ authorization_url: data.data.authorization_url, reference, fee: appt.fee_amount })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not start payment' })
  }
}