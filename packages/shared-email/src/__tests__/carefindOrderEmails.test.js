import { describe, it, expect } from 'vitest'
import { getTemplate } from '../templates/index.js'

// The order page is /orders/<order id>. The emails used to link /orders/<order ref> (CF-123456), which the page cannot open.
const ORDER_ID = '3f6c1e2a-7b8d-4e9f-a1b2-c3d4e5f60718'
const render = (key, payload) => {
  const out = getTemplate(key, 'carefind')(payload)
  return typeof out === 'string' ? out : out.html
}

describe('CareFind order emails', () => {
  it('the status email links to the order by its id, never by its reference', () => {
    const html = render('order_status_update', { fullName: 'Ada', orderId: ORDER_ID, orderRef: 'CF-123456', status: 'shipped', businessName: 'MediCare' })
    expect(html).toContain(`/orders/${ORDER_ID}`)
    expect(html).not.toContain('/orders/CF-123456')
    expect(html).toContain('Your order is on its way')
  })

  it('a delivery quote asks the customer to pay', () => {
    const html = render('order_status_update', { fullName: 'Ada', orderId: ORDER_ID, orderRef: 'CF-123456', status: 'delivery_quoted' })
    expect(html).toContain('Your delivery has been quoted')
    expect(html).toContain('Pay for your order')
    expect(html).toContain(`/orders/${ORDER_ID}`)
  })

  it('without an order id the link falls back to the order list', () => {
    const html = render('order_status_update', { orderRef: 'CF-123456', status: 'delivered' })
    expect(html).toMatch(/\/orders"/)
  })

  it('the order confirmation links to the order', () => {
    const html = render('order_confirmation', { fullName: 'Ada', orderId: ORDER_ID, orderRef: 'CF-123456', items: [], totalNaira: 5000 })
    expect(html).toContain(`/orders/${ORDER_ID}`)
    expect(html).toContain('Track your order')
  })
})
