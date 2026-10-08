import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The vendor's side of a CareFind order (Shop-Flow-Review SV-1 .. SV-3): a notification opens the order, the status filter
// filters by the status just chosen, and a pickup order is finished when the customer collects it.

const vendor = vi.hoisted(() => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  updateStatus: vi.fn(),
  quoteDelivery: vi.fn(),
  sendMessage: vi.fn(),
}))
vi.mock('../shopVendorRepository', () => ({ createShopVendorRepository: () => vendor }))
vi.mock('../repositories', () => ({
  createEcommerceRepository: () => ({
    getApplication: vi.fn().mockResolvedValue({ status: 'Approved' }),
    getInventoryWithStatus: vi.fn().mockResolvedValue([]),
    getTermsForSegment: vi.fn().mockResolvedValue({ body: 'Terms' }),
  }),
}))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))
vi.mock('../VendorTrackingPanel', () => ({ default: () => null }))
const router = vi.hoisted(() => ({ params: {}, navigate: vi.fn() }))
vi.mock('react-router-dom', () => ({ useParams: () => router.params, useNavigate: () => router.navigate }))

import Ecommerce from '../Ecommerce'

const ORDER = {
  id: 'o1', order_ref: 'CF-100', status: 'ready_for_pickup', payment_status: 'paid', delivery_preference: 'pickup',
  customer_name: 'Ada', subtotal_kobo: 20000, fulfilment_kobo: 50000, delivery_kobo: 0, total_kobo: 70000, commission_kobo: 4000,
  created_at: '2026-10-01T10:00:00Z', items: [], history: [], messages: [], shop_order_items: [],
}

describe('Ecommerce: vendor orders', () => {
  let host, root
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  const render = async () => { await act(async () => { root.render(<Ecommerce brand={{ id: 'b1', business_type: 'pharmacy' }} role="Owner" />) }); await flush(); await flush() }
  const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))

  beforeEach(() => {
    Object.values(vendor).forEach((f) => f.mockReset())
    vendor.listOrders.mockResolvedValue([ORDER])
    vendor.getOrder.mockResolvedValue(ORDER)
    vendor.updateStatus.mockResolvedValue(null)
    router.params = {}
    router.navigate.mockReset()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

  it('opens the order named in the URL (a notification link) and returns to E-commerce when it is closed', async () => {
    router.params = { orderId: 'o1' }
    await render()
    expect(vendor.getOrder).toHaveBeenCalledWith('o1')
    expect(host.querySelector('[role="dialog"]').getAttribute('aria-label')).toBe('Order CF-100')
    await act(async () => { host.querySelector('[role="dialog"] button[aria-label="Close"]').click() })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(router.navigate).toHaveBeenCalledWith('/dashboard/ecommerce', { replace: true })
  })

  it('says so when the order in the URL is not this business\'s, instead of loading forever', async () => {
    router.params = { orderId: 'someone-elses' }
    vendor.getOrder.mockResolvedValue(null)
    await render()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain('This order could not be found for your business')
  })

  it('filters by the status just chosen (not the one before it)', async () => {
    await render()
    const select = [...host.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'delivery_quote_pending'))
    await act(async () => {
      select.value = 'paid'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(vendor.listOrders).toHaveBeenLastCalledWith('b1', { status: 'paid', search: undefined })
  })

  it('a pickup order ready for collection is completed as "Collected by Customer", never sent in transit', async () => {
    await render()
    await act(async () => { host.querySelector('[aria-label="Open order CF-100"]').click() })
    await flush()
    expect(button('In Transit')).toBeUndefined()
    await act(async () => { button('Collected by Customer').click() })
    await flush()
    expect(vendor.updateStatus).toHaveBeenCalledWith('o1', 'delivered', 'Collected by customer')
  })

  it('quotes delivery through the form in the drawer (no browser prompt) and shows the order waiting for payment', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    const waiting = { ...ORDER, status: 'delivery_quote_pending', payment_status: 'pending', delivery_preference: 'home', delivery_city: 'Jalingo' }
    vendor.getOrder.mockResolvedValueOnce(waiting).mockResolvedValue({ ...waiting, status: 'pending_payment', delivery_kobo: 250000 })
    vendor.quoteDelivery.mockResolvedValue(null)
    await render()
    await act(async () => { host.querySelector('[aria-label="Open order CF-100"]').click() })
    await flush()
    await act(async () => { button('Quote Delivery').click() })
    const input = host.querySelector('form[aria-label="Delivery quote"] input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, '2500'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { host.querySelector('form[aria-label="Delivery quote"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(vendor.quoteDelivery).toHaveBeenCalledWith('o1', 250000)
    expect(promptSpy).not.toHaveBeenCalled()
    expect(host.querySelector('form[aria-label="Delivery quote"]')).toBeNull()
    expect(host.querySelector('[role="dialog"]').textContent).toContain('pending_payment')
    promptSpy.mockRestore()
  })

  it('a home delivery ready to go is sent in transit', async () => {
    vendor.getOrder.mockResolvedValue({ ...ORDER, delivery_preference: 'home' })
    await render()
    await act(async () => { host.querySelector('[aria-label="Open order CF-100"]').click() })
    await flush()
    expect(button('Collected by Customer')).toBeUndefined()
    expect(button('In Transit')).toBeDefined()
  })
})
