import { createClient } from '@supabase/supabase-js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from '../_lib/emailService.js'
import { verifyUser } from '../_lib/verifyUser.js'
import { userOwnsBusiness } from '../_lib/businessOwnership.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Cancel appointment — releases the slot, processes refund if applicable.
// Business owner or patient can cancel (with different rules).
//
// POST /api/cancel-appointment
//   { appointment_id, reason?, cancelled_by: 'owner' | 'patient' }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { appointment_id: appointmentId, reason, cancelled_by: cancelledBy } = req.body || {}

  if (!appointmentId) {
    return res.status(400).json({ error: 'Missing appointment_id' })
  }

  if (!cancelledBy || !['owner', 'patient'].includes(cancelledBy)) {
    return res.status(400).json({ error: 'cancelled_by must be "owner" or "patient"' })
  }

  // Fetch the appointment
  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('id, business_id, client_name, client_email, service, date, time, status, payment_status, fee_amount, timeslot_id, payment_reference')
    .eq('id', appointmentId)
    .maybeSingle()

  if (apptErr || !appt) {
    return res.status(404).json({ error: 'Appointment not found' })
  }

  // Only pending or confirmed appointments can be cancelled
  if (!['pending', 'confirmed'].includes(appt.status)) {
    return res.status(400).json({ error: `Cannot cancel appointment with status "${appt.status}"` })
  }

  // The owner role skips the patient's cancellation window, so it must be earned with a verified
  // owner session. It used to be taken from the request body (financial audit F-25). The patient
  // role stays capability-based: bookings can be anonymous, and the unguessable appointment id is
  // the patient's only credential.
  if (cancelledBy === 'owner') {
    const user = await verifyUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Sign in as the business owner to cancel as the business' })
    if (!(await userOwnsBusiness(supabase, user, appt.business_id))) {
      return res.status(403).json({ error: 'You do not own this business' })
    }
  }

  // If patient is cancelling, check if it's within the allowed window (24 hours before)
  if (cancelledBy === 'patient') {
    const appointmentDate = new Date(`${appt.date}T${appt.time || '00:00'}`)
    const hoursUntil = (appointmentDate - new Date()) / (1000 * 60 * 60)
    if (hoursUntil < 24 && hoursUntil > 0) {
      return res.status(400).json({ error: 'Cannot cancel within 24 hours of the appointment. Please contact the business directly.' })
    }
    // If appointment is in the past, don't allow patient cancellation
    if (hoursUntil < 0) {
      return res.status(400).json({ error: 'Cannot cancel a past appointment.' })
    }
  }

  // Update appointment status to cancelled
  const { error: updateErr } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      notes: reason ? `${appt.notes || ''}\nCancelled by ${cancelledBy}: ${reason}`.trim() : appt.notes,
    })
    .eq('id', appointmentId)

  if (updateErr) {
    return res.status(500).json({ error: 'Could not cancel appointment' })
  }

  // Free the timeslot if linked (the trigger handles this, but we do it explicitly too for safety)
  if (appt.timeslot_id) {
    await supabase
      .from('service_availability')
      .update({ is_booked: false, status: 'available', appointment_id: null })
      .eq('id', appt.timeslot_id)
  } else {
    // Legacy: free by business/date/time/service
    await supabase
      .from('service_availability')
      .update({ is_booked: false, status: 'available', appointment_id: null })
      .eq('business_id', appt.business_id)
      .eq('date', appt.date)
      .eq('time', appt.time)
      .eq('is_booked', true)
  }

  // Process refund if payment was made (within 72-hour dispute window)
  if (appt.payment_status === 'paid' && appt.fee_amount > 0) {
    const appointmentCreated = new Date(appt.created_at)
    const hoursSinceCreation = (Date.now() - appointmentCreated.getTime()) / (1000 * 60 * 60)

    if (hoursSinceCreation <= 72) {
      // Within dispute window — mark for refund review
      await supabase
        .from('appointments')
        .update({ payment_status: 'refunded', refunded_at: new Date().toISOString() })
        .eq('id', appointmentId)

      // Record refund in wallet ledger
      if (appt.business_id) {
        await supabase.from('business_wallet_transactions').insert({
          business_id: appt.business_id,
          appointment_id: appointmentId,
          type: 'refund',
          amount: -appt.fee_amount,
          reference: appt.payment_reference,
          status: 'confirmed',
        })

        // NOTE: this used to "reverse the held balance" by filing a fake withdrawal (request_business_withdrawal with
        // bank 'refund' / account 0000000000). That abused the withdrawal path - it left a payout request that
        // nothing could ever settle - and the function is gone with the withdrawal engine (Phase 08). The wallet
        // reversal and the money back to the client belong to the refund engine (Phase 09); until then the
        // appointment stays marked 'refunded' for review, exactly as the comment above says.
      }
    }
  }

  // Notify the business
  await supabase.from('staff_notifications').insert({
    business_id: appt.business_id,
    staff_id: null,
    is_owner: true,
    kind: 'booking_cancelled',
    title: `Appointment cancelled — ${appt.client_name}`,
    body: `${appt.date} at ${appt.time} — ${cancelledBy === 'patient' ? 'Patient cancelled' : 'Cancelled by business'}`,
    link: '/dashboard/appointments',
    read_at: null,
  }).catch(() => {})

  // Client notification email (fire-and-forget; never blocks a cancellation)
  if (appt.client_email && appt.client_email.includes('@')) {
    try {
      await enqueueOutbox({
        templateKey: 'booking_cancelled',
        toEmail: appt.client_email,
        payload: { fullName: appt.client_name, service: appt.service, date: appt.date, time: appt.time },
        subject: 'Your booking has been cancelled',
        sourceId: appt.id,
        idempotencyKey: `booking-cancelled:${appt.id}`,
      })
      flushOutbox().catch((err) => console.error('[cancel-appointment] outbox flush error:', err))
    } catch (err) {
      console.error('[cancel-appointment] email enqueue error:', err)
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Appointment cancelled',
    slot_freed: true,
    refund_processed: appt.payment_status === 'paid' && appt.fee_amount > 0,
  })
}
