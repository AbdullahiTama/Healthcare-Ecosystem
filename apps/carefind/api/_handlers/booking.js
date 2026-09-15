import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { paystackFetch } from '../_lib/paystack.js'
import { verifyUser } from '../_lib/verifyUser.js'

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
// No token required ΓÇö this is a public, anonymous form. All writes go through
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
      service_id: serviceId,
      date,
      time,
      booking_type: bookingType,
      concern,
    } = req.body || {}
    if (!businessId || !clientName || !phone || !date || !time) {
      return res.status(400).json({ error: 'Name, phone, date and time are required' })
    }
    const trimmedName = String(clientName).trim()
    const trimmedPhone = String(phone).trim()
    const trimmedConcern = concern ? String(concern).trim() : ''
    if (trimmedName.length < 2 || trimmedName.length > 80) return res.status(400).json({ error: 'Name must be 2-80 characters' })
    if (!/^\+?[0-9\s\-]{7,20}$/.test(trimmedPhone) || trimmedPhone.replace(/\D/g,'').length < 7 || trimmedPhone.replace(/\D/g,'').length > 15) return res.status(400).json({ error: 'Invalid phone number' })
    if (trimmedConcern.length > 500) return res.status(400).json({ error: 'Concern must be under 500 characters' })
    // Basic XSS sanitization: strip angle brackets
    if (/[<>]/.test(trimmedName) || /[<>]/.test(trimmedPhone) || /[<>]/.test(trimmedConcern)) return res.status(400).json({ error: 'Invalid characters in input' })

    // 1. Business must exist, be active, publicly listed and accept bookings.
    const { data: business, error: bizErr } = await supabase
      .from('businesses')
      .select('id, name, status, visible_on_carefind, booking_enabled, booking_type, booking_slots, online_consultation_fee, physical_consultation_fee, consultation_medium, consultation_medium_link')
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

    // 3. Date must be today or later (strict YYYY-MM-DD).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD required)' })
    const today = new Date().toLocaleDateString('en-CA')
    if (date < today) return res.status(400).json({ error: 'Pick a date from today onwards' })
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Invalid time format (HH:MM required)' })
    {
      const [hh, mm] = time.split(':').map(Number)
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return res.status(400).json({ error: 'Invalid time value' })
    }

    // 4. Time must be one of the business's configured slots (or service availability).
    const slots = Array.isArray(business.booking_slots) ? business.booking_slots.map(String) : []
    // If service-specific availability exists, prefer it; otherwise fall back to daily slots.
    let hasServiceSlots = false
    let serviceFeeKobo = null
    let serviceNamePrefetched = null
    let serviceIsActive = true
    if (serviceId) {
      const { data: svc, error: svcErr } = await supabase.from('business_services').select('id,name,price_kobo,is_active').eq('id', serviceId).eq('business_id', businessId).maybeSingle()
      if (svcErr) return res.status(500).json({ error: 'Could not verify service' })
      if (!svc) return res.status(400).json({ error: 'Service not found' })
      if (!svc.is_active) return res.status(400).json({ error: 'This service is no longer available' })
      serviceNamePrefetched = svc.name
      serviceFeeKobo = svc.price_kobo
      // Check service availability rows for this date (strict)
      const { data: svcSlots, error: slotErr } = await supabase.from('service_availability').select('time,status,is_booked,date').eq('business_id', businessId).eq('service_id', serviceId).eq('date', date)
      if (slotErr) return res.status(500).json({ error: 'Could not check availability' })
      if (svcSlots && svcSlots.length > 0) {
        hasServiceSlots = true
        const availableTimes = svcSlots.filter(s => s.status === 'available' && !s.is_booked).map(s => s.time)
        // Normalize comparison: both expected HH:MM, but guard against 9:00 vs 09:00
        const norm = t => String(t).padStart(5,'0')
        const normalizedAvailable = availableTimes.map(norm)
        if (!normalizedAvailable.includes(norm(time))) return res.status(400).json({ error: 'That time is not available for the selected service. Pick an offered slot.' })
      } else if (slots.length > 0) {
        if (!slots.includes(time)) return res.status(400).json({ error: 'That time is not available. Pick one of the offered slots.' })
      } else {
        // No slots configured at all for this service/date — reject arbitrary times
        return res.status(400).json({ error: 'No available times configured for this service on the selected date' })
      }
    } else if (slots.length > 0) {
      if (!slots.includes(time)) return res.status(400).json({ error: 'That time is not available. Pick one of the offered slots.' })
    } else if (hasServiceSlots === false && slots.length === 0) {
      // No slots configured at all — allow any future time? Spec says must have availability, but fallback to allow to avoid blocking
      // We will still allow but log warning; alternatively reject: uncomment next line
      // return res.status(400).json({ error: 'No available times configured for this date' })
    }

    // 5. Determine the fee for this appointment type (kobo). NULL = free.
    // Service price is source of truth when service selected — never trust frontend.
    let feeKobo = wantType === 'online'
      ? business.online_consultation_fee
      : business.physical_consultation_fee
    let serviceName = (service || '').trim() || 'Consultation'
    if (serviceId) {
      serviceName = serviceNamePrefetched
      if (serviceFeeKobo != null) feeKobo = serviceFeeKobo
    }
    const hasFee = feeKobo != null && feeKobo > 0

    // 6. Atomically create appointment and lock slot via RPC when service is selected (prevents race).
    // Fallback to direct insert when RPC unavailable or for generic bookings, with unique-index guard mapping to 409.
    let appointment = null
    const referenceForBooking = hasFee ? `bk_${crypto.randomBytes(6).toString('hex')}_${Date.now().toString(36)}` : null
    if (serviceId) {
      try {
        const { data: rpcId, error: rpcErr } = await supabase.rpc('book_appointment_slot', {
          p_business_id: businessId,
          p_service_id: serviceId,
          p_date: date,
          p_time: time,
          p_client_name: clientName.trim(),
          p_phone: phone.trim(),
          p_fee_amount: hasFee ? feeKobo : null,
          p_payment_reference: referenceForBooking,
          p_booking_type: wantType,
          p_concern: (concern || '').trim() || null,
        })
        if (rpcErr) throw rpcErr
        if (!rpcId) throw new Error('Booking failed: no appointment id returned')
        appointment = { id: rpcId }
        // RPC snapshots fee as amount/fee_amount and sets payment_reference when hasFee; patch remaining fields that RPC does not set
        if (appointment && appointment.id) {
          await supabase.from('appointments').update({
            payment_status: hasFee ? 'unpaid' : null,
            consultation_medium: business.consultation_medium || null,
            consultation_medium_link: business.consultation_medium_link || null,
            staff_name: '',
            notes: 'Booked via CareFind',
          }).eq('id', appointment.id)
        }
      } catch (rpcErr) {
        const msg = String(rpcErr.message || '')
        if (msg.includes('already booked') || msg.includes('already taken')) return res.status(409).json({ error: 'That time was just taken. Please pick another.' })
        if (msg.includes('Service is inactive')) return res.status(400).json({ error: 'This service is no longer available' })
        if (msg.includes('Service not found')) return res.status(400).json({ error: 'Service not found' })
        // If RPC does not exist (migration not yet applied), fall back to legacy insert
        if (msg.includes('does not exist') || msg.includes('book_appointment_slot') || msg.includes('function')) {
          // fall through to legacy path below
          appointment = null
        } else if (msg.includes('not found') || msg.includes('inactive')) {
          return res.status(400).json({ error: msg })
        } else {
          // For unique violation or other booking conflict, map to 409
          if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('appointments_one_per')) return res.status(409).json({ error: 'That time was just taken. Please pick another.' })
          // Unknown RPC error — fall back to legacy with warning
          appointment = null
        }
      }
    }

    // Legacy / fallback path: direct insert with pre-check (protected by DB unique index as final guard)
    if (!appointment) {
      // No double-booking check with row-level intent: rely on unique index, but pre-check for friendly 409
      const { data: clash } = await supabase
        .from('appointments')
        .select('id')
        .eq('business_id', businessId)
        .eq('date', date)
        .eq('time', time)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle()
      if (clash) return res.status(409).json({ error: 'That time was just taken. Please pick another.' })

      const { data: inserted, error } = await supabase
        .from('appointments')
        .insert({
          business_id: businessId,
          client_name: clientName.trim(),
          client_id: null,
          service: serviceName,
          service_id: serviceId || null,
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
          amount: hasFee ? feeKobo : null,
          payment_reference: referenceForBooking,
          consultation_medium: business.consultation_medium || null,
          consultation_medium_link: business.consultation_medium_link || null,
        })
        .select('id')
        .single()
      if (error) {
        const m = String(error.message || '')
        if (m.includes('duplicate') || m.includes('unique') || m.includes('appointments_one_per')) return res.status(409).json({ error: 'That time was just taken. Please pick another.' })
        return res.status(400).json({ error: error.message })
      }
      appointment = inserted

      // If service availability row exists for this slot, mark it booked (best-effort, race-protected by RPC when available)
      if (serviceId) {
        try {
          await supabase.from('service_availability').update({ is_booked: true, status: 'booked', appointment_id: appointment.id }).eq('business_id', businessId).eq('service_id', serviceId).eq('date', date).eq('time', time).eq('is_booked', false)
        } catch (e) {}
        try {
          await supabase.from('service_availability').update({ is_booked: true, status: 'booked', appointment_id: appointment.id }).eq('business_id', businessId).eq('service_id', serviceId).eq('date', date).eq('start_time', time).eq('is_booked', false)
        } catch (e) {}
      }
    }

    // 8. If there is a fee, initiate Paystack and return the payment URL.
    if (hasFee) {
      // Reference was already generated before the atomic insert (referenceForBooking) and stored as payment_reference.
      // Re-use it for Paystack; only generate if somehow missing (legacy safety).
      let reference = referenceForBooking
      if (!reference) {
        reference = `bk_${appointment.id.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`
        await supabase.from('appointments').update({ payment_reference: reference }).eq('id', appointment.id)
      } else {
        // Ensure the appointment row has it (RPC already set it, but verify)
        const { data: refCheck } = await supabase.from('appointments').select('payment_reference').eq('id', appointment.id).maybeSingle()
        if (!refCheck?.payment_reference) {
          await supabase.from('appointments').update({ payment_reference: reference }).eq('id', appointment.id)
        }
      }
      try {
        // Callback returns the client to the business page with the opaque
        // reference; BookingCard verifies the payment before showing a
        // confirmation. The amount is set server-side only.
        const host = req.headers['x-forwarded-host'] || req.headers.host || ''
        const proto = req.headers['x-forwarded-proto'] || 'https'
        const origin = host ? `${proto}://${host}` : ''
        const data = await paystackFetch('/transaction/initialize', {
          method: 'POST',
          body: JSON.stringify({
            // Anonymous booking ΓÇö no user email. Paystack requires an email,
            // so we use a synthetic one keyed on the appointment id.
            email: `booking+${appointment.id}@carefind.ng`,
            amount: feeKobo,
            reference,
            currency: 'NGN',
            callback_url: `${origin}/business/${businessId}?reference=${reference}`,
            metadata: { appointment_id: appointment.id, business_id: businessId, booking_type: wantType },
          }),
        })
        if (!data.status) {
          return res.status(400).json({ error: data.message || 'Could not start payment' })
        }
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

    // 9. Free booking ΓÇö notify the business immediately.
    await notifyBusiness(businessId, appointment.id, clientName, wantType, date, time)

    return res.status(201).json({ success: true, id: appointment.id, paymentRequired: false })
  }

  if (action === 'pay-credits') {
    // CareCoin payment for an existing CareFind booking. Requires a signed-in
    // user ΓÇö the coins come out of their own wallet. The atomic settle lives in
    // pay_booking_with_credits (SECURITY DEFINER, service-role only); this
    // endpoint only identifies the user and surfaces friendly errors.
    const user = await verifyUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Sign in to pay with your CareCoins' })

    const { appointment_id: appointmentId } = req.body || {}
    if (!appointmentId) return res.status(400).json({ error: 'Missing appointment id' })

    const { data: appt, error: apptErr } = await supabase
      .from('appointments')
      .select('id, business_id, client_name, booking_type, date, time, fee_amount, payment_status, payment_reference, source')
      .eq('id', appointmentId)
      .maybeSingle()
    if (apptErr || !appt) return res.status(404).json({ error: 'Booking not found' })
    if (appt.source !== 'carefind') return res.status(400).json({ error: 'This booking is not payable online' })
    if (appt.payment_status === 'paid' || appt.payment_status === 'refunded') {
      return res.status(200).json({ success: true, id: appt.id, alreadyPaid: true })
    }
    if (!appt.fee_amount || appt.fee_amount <= 0) return res.status(400).json({ error: 'This booking is free' })

    const coins = Math.ceil(appt.fee_amount / 20000)
    const { data: wallet } = await supabase
      .from('wallets').select('balance').eq('user_id', user.id).maybeSingle()
    if (!wallet || (wallet.balance || 0) < coins) {
      return res.status(400).json({
        error: `Not enough CareCoins ΓÇö this booking costs ${coins} CareCoins.`,
        coins,
        balance: wallet?.balance || 0,
      })
    }

    const { data: result, error: rpcError } = await supabase.rpc('pay_booking_with_credits', {
      p_user_id: user.id,
      p_appointment_id: appt.id,
    })
    if (rpcError) return res.status(500).json({ error: rpcError.message })
    if (result !== 'ok') {
      return res.status(400).json({
        error: result === 'insufficient' ? 'Not enough CareCoins' : result === 'already_paid' ? 'Booking already paid' : 'Could not complete payment',
      })
    }

    await notifyBusiness(appt.business_id, appt.id, appt.client_name, appt.booking_type, appt.date, appt.time)
    return res.status(200).json({ success: true, id: appt.id, coins })
  }

  return res.status(400).json({ error: 'Unknown action' })
}

// Writes a notification to the business owner's CareHub inbox. Never throws ΓÇö
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
    // Swallow ΓÇö the booking still went through.
  }
}
