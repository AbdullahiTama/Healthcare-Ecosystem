// Shared by verify-consultation-payment.js (called when the user returns from
// Paystack) and paystack-webhook.js (Paystack's own async notification) —
// both race the same reference when a professional consultation is paid by
// card. settle_consultation_payment() is a SECURITY DEFINER RPC
// (service_role-only — see 20260811_professional_consultations.sql) that
// claims the reference against a partial unique index, inserts the paid
// booking, and credits the professional's wallet as one atomic unit, so only
// one of the two racing callers can ever settle anything.
export async function settleConsultationPayment(supabase, { patientId, professionalId, nairaAmount, reference }) {
  const { data, error } = await supabase.rpc('settle_consultation_payment', {
    p_patient: patientId,
    p_professional: professionalId,
    p_fee: nairaAmount,
    p_reference: reference,
  })

  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  return {
    alreadyProcessed: row?.already_processed ?? false,
    alreadyBooked: row?.already_booked ?? false,
  }
}
