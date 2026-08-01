import { createClient } from '@supabase/supabase-js'

// Public booking endpoint for CareFind business profiles.
// No token required (this is a public, anonymous form) — all writes go
// through the service-role client, so CareHub's RLS stays untouched.
// The business itself controls availability via `booking_enabled`,
// `booking_type` and `booking_slots` (set in CareHub → Settings → Booking).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { action } = req.body || {}

  if (action === 'create') {
    // Accepts the CareFind public-form payload (business_id / name / booking_type).
    const {
      business_id: businessId,
      name: clientName,
      phone,
      service,
      date,
      time,
      booking_type: bookingType,
    } = req.body || {}
    if (!businessId || !clientName || !phone || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, date and time are required' })
    }

    // 1. Business must exist, be active, publicly listed and accept bookings.
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('id, name, status, visible_on_carefind, booking_enabled, booking_type, booking_slots')
      .eq('id', businessId)
      .maybeSingle()
    if (bizErr || !business) return res.status(404).json({ error: 'Business not found' })
    if (business.status !== 'active' || business.visible_on_carefind === false) {
      return res.status(403).json({ error: 'This business is not currently accepting bookings' })
    }
    if (!business.booking_enabled) return res.status(403).json({ error: 'Online booking is not enabled for this business' })

    // 2. Booking type must be permitted by the business config.
    const wantType = bookingType === 'online' ? 'online' : 'physical'
    if (business.booking_type === 'physical' && wantType === 'online') {
      return res.status(403).json({ error: 'This business only takes physical appointments' })
    }
    if (business.booking_type === 'online' && wantType === 'physical') {
      return res.status(403).json({ error: 'This business only takes online appointments' })
    }

    // 3. Date must be today or later.
    const today = new Date().toISOString().split('T')[0]
    if (date < today) return res.status(400).json({ error: 'Pick a date from today onwards' })

    // 4. Time must be one of the business's configured slots.
    const slots = Array.isArray(business.booking_slots) ? business.booking_slots.map(String) : []
    if (slots.length > 0 && !slots.includes(time)) {
      return res.status(400).json({ error: 'That time is not available. Pick one of the offered slots.' })
    }

    // 5. No double-booking of the same slot (pending/confirmed only — cancelled
    //    and completed slots can be rebooked).
    const { data: clash } = await supabase
      .from('appointments')
      .select('id')
      .eq('business_id', businessId)
      .eq('date', date)
      .eq('time', time)
      .in('status', ['pending', 'confirmed'])
      .maybeSingle()
    if (clash) return res.status(409).json({ error: 'That time was just taken. Please pick another.' })

    const { data: appointment, error } = await supabase
      .from('appointments')
      .insert({
        business_id: businessId,
        client_name: clientName.trim(),
        client_id: null,
        service: (service || '').trim() || 'Consultation',
        date,
        time,
        status: 'pending',
        staff_name: '',
        notes: 'Booked via CareFind',
        booking_type: wantType,
        source: 'carefind',
        phone: phone.trim(),
      })
      .select('id')
      .single()
    if (error) return res.status(400).json({ error: error.message })

    return res.status(201).json({ success: true, id: appointment.id })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
