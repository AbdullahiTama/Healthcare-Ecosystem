import { createClient } from '@supabase/supabase-js'
import { enqueue as enqueueOutbox } from '../_lib/emailService.js'
import { flushOutbox } from '../_lib/outbox.js'
import { verifyUser } from '../_lib/verifyUser.js'
import { userOwnsBusiness } from '../_lib/businessOwnership.js'
import { requestRefund, executeCardRefund } from '@care-ecosystem/shared-payments'
import { getPaystackProvider, paymentLogger } from '../_lib/payments.js'
import { applyRefundResult } from '../_lib/refundEffects.js'

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

  // Refund through the refund engine. Reaching this point means the cancellation is allowed under the refund policy (the
  // business may cancel at any time; a patient only 24h or more ahead, checked above), so a paid card / CareCoin booking
  // is refunded in full: a card refund goes back through Paystack and completes only when Paystack confirms; CareCoins go
  // back through the ledger. The business's share is recovered inside the engine. If anything here fails, the cron
  // finds cancelled-but-unrefunded appointments and finishes the job, so a crash can never lose a refund.
  let refund = { status: 'none' }
  if (appt.payment_status === 'paid' && appt.fee_amount > 0) {
    refund = await refundCancelledBooking(appointmentId)
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

  // Client notification email (best-effort: a failure here never fails a cancellation)
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
      await flushOutbox()
    } catch (err) {
      console.error('[cancel-appointment] email enqueue error:', err)
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Appointment cancelled',
    slot_freed: true,
    refund_processed: ['completed', 'processing', 'pending'].includes(refund.status),
    refund,
  })
}

// -> { status: 'completed' | 'processing' | 'pending' | 'failed' | 'already' | 'offline' | 'not_refunded' }
//   completed   money is back with the customer (CareCoins) or the provider confirmed the refund
//   processing  the provider accepted the refund; it completes by webhook
//   pending     could not be sent yet; the cron retries
//   offline     paid at the POS / by transfer / cash: the platform never held that money, the business refunds the client directly
async function refundCancelledBooking(appointmentId) {
  try {
    const r = await requestRefund(supabase, { cause: 'booking_cancelled', entityType: 'appointment', entityId: appointmentId, reason: 'appointment cancelled' })
    if (r.outcome === 'completed') return { status: 'completed' }
    if (r.outcome === 'requested') {
      const sent = await executeCardRefund(supabase, getPaystackProvider(), r, { reason: 'Appointment cancelled', logger: paymentLogger, onSettled: (result) => applyRefundResult(supabase, result) })
      return { status: sent.state }
    }
    if (r.outcome === 'already_requested' || r.outcome === 'already_refunded') return { status: 'already' }
    if (r.outcome === 'not_refundable_by_platform') return { status: 'offline' }
    console.error('[cancel-appointment] refund not created', { appointmentId, outcome: r.outcome })
    return { status: 'not_refunded', reason: r.outcome }
  } catch (err) {
    console.error('[cancel-appointment] refund request failed; the cron will retry', { appointmentId, message: err.message })
    return { status: 'pending' }
  }
}
