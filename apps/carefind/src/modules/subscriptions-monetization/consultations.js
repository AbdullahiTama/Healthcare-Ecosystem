import { supabase } from '../../config/supabaseClient'

// 1 CareCoin = ₦200
export const NAIRA_PER_COIN = 200

// A consultation costs the whole fee in CareCoins, rounded up so the
// platform never over-credits against the naira equivalent.
export function coinsForConsultation(feeNaira) {
  const naira = Number(feeNaira) || 0
  if (naira <= 0) return 0
  return Math.ceil(naira / NAIRA_PER_COIN)
}

// The professional's consultation offer — their status='setup' row, which is
// what /u/<id> renders as the "Book Consultation" card.
export async function fetchConsultationOffer(professionalId) {
  if (!professionalId) return null
  const { data } = await supabase
    .from('professional_consultations')
    .select('*')
    .eq('professional_id', professionalId)
    .eq('status', 'setup')
    .maybeSingle()
  return data || null
}

// Has this patient already booked this professional? The paid unique index
// guarantees at most one paid booking per (professional, patient) pair.
export async function hasBookedConsultation(patientId, professionalId) {
  if (!patientId || !professionalId) return false
  const { data } = await supabase
    .from('professional_consultations')
    .select('id')
    .eq('professional_id', professionalId)
    .eq('patient_id', patientId)
    .eq('status', 'paid')
    .maybeSingle()
  return !!data
}

// Book with CareCoins — atomic on the DB (pay_professional_consultation).
// Returns { ok, insufficient, alreadyBooked, error }
export async function bookConsultation(patientId, professionalId) {
  if (!patientId || !professionalId) return { error: 'Missing user' }

  const { data, error } = await supabase.rpc('pay_professional_consultation', {
    p_professional: professionalId,
  })

  if (error) return { error: error.message }
  if (data === 'ok') return { ok: true }
  if (data === 'insufficient') return { insufficient: true }
  if (data === 'already_booked') return { alreadyBooked: true }
  return { error: 'Could not complete booking' }
}

// Try wallet first, then return a Paystack payment URL if insufficient.
// The caller redirects the user to Paystack for card payment; settlement is
// handled by the webhook (or verify-consultation-payment.js on return).
export async function bookConsultationWithPaystackFallback(patientId, professionalId, callbackUrl) {
  const walletResult = await bookConsultation(patientId, professionalId)
  if (walletResult.ok) return { ok: true }
  if (walletResult.error) return { error: walletResult.error }
  if (!walletResult.insufficient) return { error: 'Could not complete booking' }

  // Wallet insufficient — offer Paystack direct charge
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { error: 'Please log in again' }

    const response = await fetch('/api/charge-consultation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        professionalId,
        callback_url: callbackUrl,
      }),
    })

    const data = await response.json()
    if (data.authorization_url) {
      return { paystackUrl: data.authorization_url, reference: data.reference }
    }
    return { error: data.error || 'Could not initiate payment' }
  } catch (err) {
    return { error: 'Network error. Please check your connection.' }
  }
}

// After a Paystack redirect returns to the profile, settle the booking
// server-side. Idempotent: if the webhook already settled it, the RPC
// returns already_processed and nothing is credited twice.
export async function settleConsultationCardPayment(patientId, professionalId, reference) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { ok: false, error: 'Please log in again' }

    const response = await fetch('/api/verify-consultation-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ reference }),
    })

    const data = await response.json()
    if (!data.success) return { ok: false, error: data.error || 'Could not confirm payment' }
    return { ok: true, alreadyBooked: data.alreadyBooked, alreadyProcessed: data.alreadyProcessed }
  } catch (err) {
    return { ok: false, error: 'Network error. Please check your connection.' }
  }
}
