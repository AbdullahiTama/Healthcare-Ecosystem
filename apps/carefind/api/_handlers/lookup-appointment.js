import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Patient appointment lookup — allows patients to find their appointments
// by phone number and business ID. No auth required (public form).
//
// GET  /api/lookup-appointment?business_id=...&phone=...
// POST /api/lookup-appointment { business_id, phone }
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const businessId = req.query.business_id || req.body?.business_id
  const phone = req.query.phone || req.body?.phone

  if (!businessId || !phone) {
    return res.status(400).json({ error: 'Business ID and phone number are required' })
  }

  // Normalize phone: strip spaces, dashes, ensure it starts with country code
  const normalizedPhone = String(phone).replace(/[\s\-]/g, '').trim()
  if (normalizedPhone.length < 7 || normalizedPhone.length > 15) {
    return res.status(400).json({ error: 'Invalid phone number' })
  }

  // Find appointments matching this business and phone (last 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('id, client_name, service, date, time, status, payment_status, fee_amount, booking_type, created_at')
    .eq('business_id', businessId)
    .eq('phone', normalizedPhone)
    .gte('date', ninetyDaysAgo)
    .order('date', { ascending: false })
    .order('time', { ascending: false })

  if (error) {
    return res.status(500).json({ error: 'Could not look up appointments' })
  }

  if (!appointments || appointments.length === 0) {
    return res.status(404).json({ error: 'No appointments found for this phone number' })
  }

  return res.status(200).json({ success: true, appointments })
}
