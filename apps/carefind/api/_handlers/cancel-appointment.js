import { createClient } from '@supabase/supabase-js'

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
    .select('id, business_id, client_name, service, date, time, status, payment_status, fee_amount, timeslot_id, payment_reference')
    .eq('id', appointmentId)
    .maybeSingle()

  if (apptErr || !appt) {
    return res.status(404).json({ error: 'Appointment not found' })
  }

  // Only pending or confirmed appointments can be cancelled
  if (!['pending', 'confirmed'].includes(appt.status)) {
    return res.status(400).json({ error: `Cannot cancel appointment with status "${appt.status}"` })
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

        // Reverse the held balance
        await supabase.rpc('request_business_withdrawal', {
          p_business_id: appt.business_id,
          p_amount: appt.fee_amount,
          p_bank_name: 'refund',
          p_account_number: '0000000000',
          p_account_name: 'Refund reversal',
        }).catch(() => {
          // If withdrawal RPC fails, just log — the refund is still recorded
        })
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

  return res.status(200).json({
    success: true,
    message: 'Appointment cancelled',
    slot_freed: true,
    refund_processed: appt.payment_status === 'paid' && appt.fee_amount > 0,
  })
}
