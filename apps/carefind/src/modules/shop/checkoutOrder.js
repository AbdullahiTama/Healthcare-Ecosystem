// Checkout -> create_shop_order request. Pure, so both checkout paths (Paystack and Pay at Pickup) build the order the same way.
//
// create_shop_order recomputes every amount from the items and refuses an order whose numbers differ from its own, so this
// must send exactly what the server will compute:
//   * delivery is charged only for home delivery in an approved city. Elsewhere it is quoted later, so the distance is not
//     sent either (the server would otherwise charge for it and refuse the order with "Delivery fee mismatch").
//   * the total NEVER includes a promo discount: the order is created at full price and apply_promo_code_to_order() derives
//     and subtracts the discount on the server. Sending the discounted total made every promo order fail with
//     "Order total mismatch".

export function singleVendorId(items) {
  const vendorIds = [...new Set(items.map(i => i.vendor_id || i.vendor_business_id).filter(Boolean))]
  if (vendorIds.length === 0) throw new Error('Vendor not found for cart items — please re-add products from Shop')
  if (vendorIds.length > 1) throw new Error('Multi-vendor checkout is not yet supported — please checkout per vendor')
  return vendorIds[0]
}

/**
 * @param {object} p
 * @param {Array} p.items                cart items
 * @param {number} p.subtotalKobo        sum of the cart lines
 * @param {{fulfilment:number, commission:number, delivery:number}} p.fees  from calculateTotalFees()
 * @param {object} p.form                checkout form fields
 * @param {'pickup'|'home'} p.deliveryPreference
 * @param {boolean} p.approvedCity
 * @param {number} p.distanceKm
 * @param {string} p.pickupStationId
 * @param {{id:string, email?:string}} p.user
 * @param {string} p.paymentReference    idempotency key for this checkout submission
 */
export function buildOrderRequest({ items, subtotalKobo, fees, form, deliveryPreference, approvedCity, distanceKm, pickupStationId, user, paymentReference }) {
  if (!form.street || !form.city || !form.state) throw new Error('Street, city and state are required')
  if (!form.customer_phone || String(form.customer_phone).trim().length < 10) throw new Error('Valid phone number is required')
  if (!form.customer_email || !form.customer_email.includes('@')) throw new Error('Valid email is required')
  const isPickup = deliveryPreference === 'pickup'
  if (isPickup && !pickupStationId) throw new Error('Please select a pickup station')

  const chargesDelivery = !isPickup && approvedCity
  const deliveryKobo = chargesDelivery ? fees.delivery : 0

  return {
    customer_id: user.id,
    vendor_business_id: singleVendorId(items),
    items: items.map(item => ({ ecommerce_product_id: item.ecommerce_product_id, quantity: item.quantity, unit_price_kobo: item.unit_price_kobo })),
    subtotal_kobo: subtotalKobo,
    commission_kobo: fees.commission,
    fulfilment_kobo: fees.fulfilment,
    delivery_kobo: deliveryKobo,
    total_kobo: subtotalKobo + fees.fulfilment + deliveryKobo,
    delivery_address: `${form.street}, ${form.city}, ${form.state}`,
    delivery_city: form.city,
    delivery_state: form.state,
    delivery_phone: form.customer_phone,
    delivery_email: form.customer_email,
    delivery_instructions: form.delivery_instructions || null,
    delivery_preference: deliveryPreference,
    distance_km: chargesDelivery ? distanceKm : null,
    is_approved_city: approvedCity,
    customer_name: form.customer_name || user.email,
    payment_reference: paymentReference,
    pickup_station_id: isPickup ? pickupStationId : null,
  }
}

// create_shop_order's refusals, in words a customer can act on.
export function orderErrorMessage(err) {
  const msg = String(err?.message || '')
  if (msg.includes('INSUFFICIENT_STOCK')) return 'Some items are now out of stock — please review your cart. Inventory was updated after you added items.'
  if (msg.includes('PRICE_CHANGED')) return 'A product price changed while you were checking out — please review your cart and try again.'
  if (msg.includes('Vendor not approved')) return 'This vendor is not currently approved for Shop sales.'
  if (/mismatch/i.test(msg)) return 'Your order total is out of date — please refresh the page and check out again.'
  return msg || 'Failed to create order. Please try again.'
}
