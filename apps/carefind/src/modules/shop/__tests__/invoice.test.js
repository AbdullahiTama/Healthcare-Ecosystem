import { describe, it, expect } from 'vitest'
import { buildInvoiceHtml } from '../invoice'
import { formatOrderAddress } from '../orderConstants'

const order = (over = {}) => ({
  id: '3f6c1e2a-7b8d-4e9f-a1b2-c3d4e5f60718', order_ref: 'CF-482913', created_at: '2026-10-07T09:12:00Z', status: 'paid', payment_status: 'paid',
  customer_name: 'Ada', delivery_email: 'ada@example.com', delivery_phone: '0803', delivery_preference: 'home',
  delivery_address: '14 Admiralty Way, Lekki, Lagos, Lagos', delivery_city: 'Lagos', delivery_state: 'Lagos',
  subtotal_kobo: 500000, fulfilment_kobo: 60000, delivery_kobo: 60000, discount_kobo: 0, total_kobo: 620000,
  order_items: [{ product_name: 'Paracetamol', quantity: 2, unit_price_kobo: 250000 }],
  ...over,
})

describe('buildInvoiceHtml', () => {
  it('is a phone-ready document: utf-8 (for ₦) and a device-width viewport', () => {
    const html = buildInvoiceHtml(order())
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).toContain('@media (max-width: 600px)')
  })

  // The invoice opens from a blob: URL with the app's origin: vendor-written product names and customer-written addresses
  // must never become markup.
  it('escapes every value from the order', () => {
    const html = buildInvoiceHtml(order({
      customer_name: '<script>steal()</script>',
      delivery_address: '"><img src=x onerror=alert(1)>',
      order_items: [{ product_name: '<img src=x onerror=alert(2)>', quantity: 1, unit_price_kobo: 100 }],
    }))
    expect(html).not.toContain('<script>steal()')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;')
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;')
  })

  it('shows the discount so the lines add up to the total, and a readable status', () => {
    const html = buildInvoiceHtml(order({ discount_kobo: 50000, total_kobo: 570000 }))
    expect(html).toMatch(/Discount<\/td><td class="num">−₦500</)
    expect(html).toContain('₦5,700')
    expect(html).toContain('Paid')
    expect(html).not.toContain('pending_payment')
  })

  it('labels delivery truthfully: a fee, pickup, free, or waiting for a quote', () => {
    expect(buildInvoiceHtml(order())).toMatch(/Delivery<\/td><td class="num">₦600</)
    expect(buildInvoiceHtml(order({ delivery_kobo: 0, delivery_preference: 'pickup' }))).toMatch(/Delivery<\/td><td class="num">Pickup</)
    expect(buildInvoiceHtml(order({ delivery_kobo: 0 }))).toMatch(/Delivery<\/td><td class="num">Free</)
    expect(buildInvoiceHtml(order({ delivery_kobo: 0, status: 'delivery_quote_pending' }))).toMatch(/Delivery<\/td><td class="num">To be quoted</)
  })

  it('works out the subtotal from the items when the order has none, and never shows the internal placeholder reference', () => {
    const html = buildInvoiceHtml(order({ subtotal_kobo: undefined, payment_reference: 'CF-1759828320000-AB12C' }))
    expect(html).toMatch(/Subtotal<\/td><td class="num">₦5,000</)
    expect(html).not.toContain('CF-1759828320000-AB12C')
  })
})

describe('formatOrderAddress', () => {
  it('does not repeat the city and state that the stored address already ends with', () => {
    expect(formatOrderAddress(order())).toBe('14 Admiralty Way, Lekki, Lagos, Lagos')
  })
  it('adds the city and state when the address does not carry them', () => {
    expect(formatOrderAddress({ delivery_address: '5 Bank Road', delivery_city: 'Jos', delivery_state: 'Plateau' })).toBe('5 Bank Road, Jos, Plateau')
    expect(formatOrderAddress({})).toBe('')
  })
})
