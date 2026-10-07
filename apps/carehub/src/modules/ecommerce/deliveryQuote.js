// The vendor's delivery quote for a CareFind order outside the approved delivery cities: what the vendor types, and the total
// the customer will be asked to pay. The server (quote_shop_order_delivery) recomputes and enforces all of this; the form uses it to
// show the new total before the vendor confirms, and to refuse an amount the server would refuse anyway.

export const MAX_DELIVERY_QUOTE_KOBO = 100_000_000 // ₦1,000,000, the server's ceiling

// "2,500", "₦2500", " 2500.50 " -> kobo; anything else -> an error message
export function parseDeliveryQuote(input) {
  const raw = String(input ?? '').replace(/[₦,\s]/g, '')
  if (raw === '') return { error: 'Enter the delivery fee' }
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: 'Enter an amount in naira, for example 2500' }
  const kobo = Math.round(Number(raw) * 100)
  if (kobo <= 0) return { error: 'The delivery fee must be more than ₦0' }
  if (kobo > MAX_DELIVERY_QUOTE_KOBO) return { error: 'The delivery fee can be at most ₦1,000,000' }
  return { kobo }
}

// the same formula as the server: subtotal + fulfilment + delivery - any promo discount
export function quotedTotalKobo(order, deliveryKobo) {
  return Number(order?.subtotal_kobo || 0) + Number(order?.fulfilment_kobo || 0) + deliveryKobo - Number(order?.discount_kobo || 0)
}

export const naira = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
