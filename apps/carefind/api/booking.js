import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { paystackFetch } from './_lib/paystack.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Public booking endpoint for CareFind business profiles.
//
// Flow:
//   1. Validate the business, slot, and booking type (unchanged from before).
//   2. Look up the consultation fee for the chosen appointment type.
//   3. If the fee is NULL (free), insert the appointment immediately and notify
//      the business.
//   4. If there is a fee, insert the appointment as `payment_status = 'unpaid'`,
//      then initiate a Paystack transaction for that amount and return the
//      authorization URL so the client can pay. The appointment is flipped to
//      'paid' by verify-booking-payment.js once Paystack confirms.
//
// The `concern` field is the client's short statement of why they are booking.
// No token required — this is a public, anonymous form. All writes go through
// the service-role client, so CareHub's RLS stays untouched.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action } = req.body || {}

  if (action === 'create') {
    const {
      business_id: businessId,
      name: clientName,
      phone,
      service,
      date,
      time,
      booking_type: bookingType,
      concern,
    } = req.body || {}
    if (!businessId || !clientName || !phone || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, date and time are required' })
    }

    // 1. Business must exist, be active, publicly listed and accept bookings.
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('id, name, status, visible_on_carefind, booking_enabled, booking_type, booking_slots, online_consultation_fee, physical_consultation_fee')
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

    // 5. No double-booking of the same slot (pending/confirmed only).
    const { data: clash } = await supabase
      .from('appointments')
      .select('id')
      .eq('business_id', businessId)
      .eq('date', date)
      .eq('time', time)
      .in('status', ['pending', 'confirmed'])
      .maybeSingle()
    if (clash) return res.status(409).json({ error: 'That time was just taken. Please pick another.' })

    // 6. Determine the fee for this appointment type (kobo). NULL = free.
    const feeKobo = wantType === 'online'
      ? business.online_consultation_fee
      : business.physical_consultation_fee
    const hasFee = feeKobo != null && feeKobo > 0

    // 7. Insert the appointment. Paid bookings start as 'unpaid'; free ones land
    //    directly as 'pending'.
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
        concern: (concern || '').trim() || null,
        payment_status: hasFee ? 'unpaid' : null,
        fee_amount: hasFee ? feeKobo : null,
      })
      .select('id')
      .single()
    if (error) return res.status(400).json({ error: error.message })

    // 8. If there is a fee, initiate Paystack and return the payment URL.
    if (hasFee) {
      const reference = `bk_${appointment.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`
      try {
        const data = await paystackFetch('/transaction/initialize', {
          method: 'POST',
          body: JSON.stringify({
            // Anonymous booking — no user email. Paystack requires an email,
            // so we use a synthetic one keyed on the appointment id.
            email: `booking+${appointment.id}@carefind.ng`,
            amount: feeKobo,
            reference,
            currency: 'NGN',
            metadata: { appointment_id: appointment.id, business_id: businessId, booking_type: wantType },
          }),
        })
        if (!data.status) {
          return res.status(400).json({ error: data.message || 'Could not start payment' })
        }
        // Store the reference so verify can match it back.
        await supabase.from('appointments').update({ payment_reference: reference }).eq('id', appointment.id)
        return res.status(200).json({
          success: true,
          id: appointment.id,
          paymentRequired: true,
          authorization_url: data.data.authorization_url,
          reference,
          fee: feeKobo,
        })
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Could not start payment' })
      }
    }

    // 9. Free booking — notify the business immediately.
    await notifyBusiness(businessId, appointment.id, clientName, wantType, date, time)

    return res.status(201).json({ success: true, id: appointment.id, paymentRequired: false })
  }

  return res.status(400).json({ error: 'Unknown action' })
}

// Writes a notification to the business owner's CareHub inbox. Never throws —
// a failed notification must not break the booking.
async function notifyBusiness(businessId, appointmentId, clientName, bookingType, date, time) {
  try {
    await supabase.from('staff_notifications').insert({
      business_id: businessId,
      staff_id: null,
      is_owner: true,
      kind: 'booking_created',
      title: `New ${bookingType} booking from ${clientName}`,
      body: `${date} at ${time}`,
      link: '/dashboard/appointments',
      read_at: null,
    })
  } catch (e) {
    // Swallow — the booking still went through.
  }
}
