import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import QuoteDeliveryForm from '../QuoteDeliveryForm'

// The delivery quote form that replaced the browser prompt(): the vendor sees the new total before sending, a bad amount is caught
// before the server is called, and a refusal from the server is shown next to the amount.

const ORDER = {
  id: 'o1', delivery_preference: 'home', delivery_address: '12 Allen Ave', delivery_city: 'Jalingo', delivery_state: 'Taraba', distance_km: 14,
  subtotal_kobo: 20000, fulfilment_kobo: 60000, discount_kobo: 0, total_kobo: 80000,
}

describe('QuoteDeliveryForm', () => {
  let host, root
  const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))
  const render = async (order, onSubmit) => { await act(async () => { root.render(<QuoteDeliveryForm order={order} onSubmit={onSubmit} />) }) }
  const type = async (value) => {
    const input = host.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const submit = () => act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

  it('opens from the Quote Delivery button and shows where the order goes', async () => {
    await render(ORDER, vi.fn())
    expect(host.querySelector('form')).toBeNull()
    await act(async () => { button('Quote Delivery').click() })
    expect(host.querySelector('form[aria-label="Delivery quote"]')).not.toBeNull()
    expect(host.textContent).toContain('12 Allen Ave, Jalingo, Taraba')
    expect(host.textContent).toContain('14 km')
  })

  it('shows the total the customer will pay as the fee is typed, then sends the fee in kobo', async () => {
    const onSubmit = vi.fn().mockResolvedValue()
    await render(ORDER, onSubmit)
    await act(async () => { button('Quote Delivery').click() })
    await type('2,500')
    expect(host.querySelector('dd[aria-live]').textContent).toBe('₦3,300')
    await submit()
    expect(onSubmit).toHaveBeenCalledWith(250000)
    expect(host.querySelector('form')).toBeNull()                       // closed after success
  })

  it('catches a bad amount without calling the server', async () => {
    const onSubmit = vi.fn()
    await render(ORDER, onSubmit)
    await act(async () => { button('Quote Delivery').click() })
    await type('0')
    await submit()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(host.textContent).toContain('more than ₦0')
    expect(host.querySelector('input').getAttribute('aria-invalid')).toBe('true')
  })

  it('shows the server\'s reason when the quote is refused, and keeps the form open', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Supabase error (400): This order is not waiting for a delivery quote'))
    await render(ORDER, onSubmit)
    await act(async () => { button('Quote Delivery').click() })
    await type('1500')
    await submit()
    expect(host.querySelector('[role="alert"]').textContent).toBe('This order is not waiting for a delivery quote')
    expect(host.querySelector('form')).not.toBeNull()
  })

  it('a pickup order has nothing to quote: it says so instead of offering a quote', async () => {
    await render({ ...ORDER, delivery_preference: 'pickup' }, vi.fn())
    expect(button('Quote Delivery')).toBeUndefined()
    expect(host.textContent).toContain('pickup order, so there is no delivery to quote')
  })
})
