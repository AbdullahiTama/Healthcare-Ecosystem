// What follows a settled appointment payment, whichever way it was paid:
//   * the BUSINESS is told in its CareHub inbox (staff_notifications), and
//   * the PATIENT gets an in-app confirmation (if signed in) and a receipt email.
//
// Called from three places — verify-booking-payment.js (Paystack redirect),
// paystack-webhook.js (Paystack's async backup) and booking.js (CareCoins) —
// which previously each hand-built the business notice. Callers MUST only call
// this for the request that actually settled the booking (the RPC returned
// 'ok'): settle_card_booking / pay_booking_with_credits row-lock the
// appointment and return 'ok' to exactly one racing caller, which is what keeps
// the business from being notified, and the patient emailed, twice.
import { bookingPaidStaffNotice } from '../../src/services/notificationCatalog.js'
import { announcePurchase } from './purchaseAnnouncements.js'

// 1 CareCoin = ₦200 = 20,000 kobo; CareCoin bookings are charged in whole coins.
const KOBO_PER_COIN = 20000

export async function announceBookingPaid(supabase, {
  appt, method, reference, buyerId = null, buyerEmail, appUrl = '', logger = console,
}) {
  const coins = method === 'coins' ? Math.ceil(appt.fee_amount / KOBO_PER_COIN) : undefined
  // What the patient actually paid: the card charge to the kobo, or whole coins.
  const amountKobo = method === 'coins' ? coins * KOBO_PER_COIN : appt.fee_amount

  try {
    const notice = bookingPaidStaffNotice({
      clientName: appt.client_name, date: appt.date, time: appt.time, amountKobo, method,
    })
    const { error } = await supabase.from('staff_notifications').insert({
      business_id: appt.business_id,
      staff_id: null,
      is_owner: true,
      kind: notice.kind,
      title: notice.title,
      body: notice.body,
      link: '/dashboard/appointments',
      read_at: null,
    })
    if (error) logger.error('[booking] business notice failed', { appointment: appt.id, message: error.message })
  } catch (err) {
    logger.error('[booking] business notice threw', { appointment: appt.id, message: err?.message })
  }

  let businessName
  try {
    const { data } = await supabase.from('businesses').select('name').eq('id', appt.business_id).maybeSingle()
    businessName = data?.name
  } catch { /* the receipt falls back to "the business" */ }

  return announcePurchase('booking', {
    buyerId,
    businessId: appt.business_id,
    businessName,
    date: appt.date,
    time: appt.time,
    bookingType: appt.booking_type,
    amountKobo,
    coins,
    method,
    reference,
  }, { supabase, appUrl, buyerEmail, logger })
}
