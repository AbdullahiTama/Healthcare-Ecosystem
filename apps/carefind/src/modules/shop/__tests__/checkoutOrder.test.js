import { describe, it, expect } from 'vitest'
import { buildOrderRequest, orderErrorMessage, singleVendorId } from '../checkoutOrder'
import { calculateTotalFees } from '../pricing'

const items = [{ ecommerce_product_id: 'e1', vendor_id: 'v1', quantity: 2, unit_price_kobo: 250000, product_name: 'Paracetamol' }]
const form = { customer_name: 'Ada', customer_phone: '08012345678', customer_email: 'ada@example.com', street: '1 Marina', city: 'Lagos', state: 'Lagos', delivery_instructions: '' }
const user = { id: 'u1', email: 'ada@example.com' }
const fees = (over = {}) => calculateTotalFees({ segment: 'retail', orderTotalKobo: 500000, ...over })
const build = (over = {}) => buildOrderRequest({ items, subtotalKobo: 500000, fees: fees(), form, deliveryPreference: 'pickup', approvedCity: true, distanceKm: 5, pickupStationId: 'st1', user, paymentReference: 'CF-1', ...over })

describe('buildOrderRequest', () => {
  it('a pickup order: items + fulfilment, no delivery, the station, no distance', () => {
    const r = build()
    expect(r).toMatchObject({ customer_id: 'u1', vendor_business_id: 'v1', subtotal_kobo: 500000, fulfilment_kobo: 60000, delivery_kobo: 0, total_kobo: 560000, commission_kobo: 100000, delivery_preference: 'pickup', distance_km: null, pickup_station_id: 'st1' })
    expect(r.items).toEqual([{ ecommerce_product_id: 'e1', quantity: 2, unit_price_kobo: 250000 }])
  })

  it('home delivery in an approved city charges the distance bracket and sends the distance', () => {
    const r = build({ deliveryPreference: 'home', fees: fees({ includeDelivery: true, distanceKm: 5 }), pickupStationId: '' })
    expect(r).toMatchObject({ delivery_kobo: 60000, total_kobo: 620000, distance_km: 5, pickup_station_id: null })
  })

  // The server recomputes delivery from distance_km: sending the hidden default distance made every out-of-zone home order fail.
  it('home delivery outside the approved cities sends no delivery fee AND no distance (it is quoted later)', () => {
    const r = build({ deliveryPreference: 'home', approvedCity: false, pickupStationId: '' })
    expect(r).toMatchObject({ delivery_kobo: 0, distance_km: null, total_kobo: 560000, is_approved_city: false })
  })

  // apply_promo_code_to_order subtracts the discount on the server; a discounted total here failed with "Order total mismatch".
  it('the total never includes a promo discount', () => {
    expect(build().total_kobo).toBe(500000 + 60000)
  })

  it.each([
    ['address', { form: { ...form, street: '' } }, /Street, city and state/],
    ['phone', { form: { ...form, customer_phone: '0801' } }, /phone/],
    ['email', { form: { ...form, customer_email: 'nope' } }, /email/],
    ['pickup station', { pickupStationId: '' }, /pickup station/],
  ])('refuses a missing %s', (_, over, msg) => {
    expect(() => build(over)).toThrow(msg)
  })
})

describe('singleVendorId', () => {
  it('accepts one vendor and refuses none or several', () => {
    expect(singleVendorId([{ vendor_business_id: 'v9' }, { vendor_business_id: 'v9' }])).toBe('v9')
    expect(() => singleVendorId([{}])).toThrow(/Vendor not found/)
    expect(() => singleVendorId([{ vendor_id: 'a' }, { vendor_id: 'b' }])).toThrow(/Multi-vendor/)
  })
})

describe('orderErrorMessage', () => {
  it('turns server refusals into actions the customer can take', () => {
    expect(orderErrorMessage(new Error('INSUFFICIENT_STOCK'))).toMatch(/out of stock/)
    expect(orderErrorMessage(new Error('PRICE_CHANGED: Price mismatch'))).toMatch(/price changed/)
    expect(orderErrorMessage(new Error('Vendor not approved'))).toMatch(/not currently approved/)
    expect(orderErrorMessage(new Error('Order total mismatch: expected 1, got 2'))).toMatch(/refresh the page/)
    expect(orderErrorMessage(new Error('Cart is empty'))).toBe('Cart is empty')
    expect(orderErrorMessage(null)).toMatch(/Failed to create order/)
  })
})
