import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// One customer's visits, newest first, each with the orders raised from it.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repository.js', () => ({ customerRepository: { list: vi.fn(), visits: vi.fn() } }))

import CustomerHistory from '../CustomerHistory.jsx'
import { customerRepository } from '../repository.js'

const CUSTOMER = { key: 'f:allen@6.450,3.390', name: 'Allen Pharmacy', kind: 'facility', address: '1 Marina' }
const VISITS = [
  { id: 'v2', created_at: '2026-10-22T10:00:00Z', rep_name: 'Ada Rep', facility_verified: true, photo_count: 2, orders: [] },
  { id: 'v1', created_at: '2026-10-01T09:00:00Z', rep_name: 'Bola', facility_verified: false, photo_count: 0, orders: [{ id: 'o1', order_ref: 'ORD-1', status: 'delivered' }] },
]

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes(text))
async function show(onClose = vi.fn()) {
  await act(async () => { root.render(<CustomerHistory businessId='biz-1' customer={CUSTOMER} onClose={onClose} />) })
  await flush(); await flush()
  return onClose
}

beforeEach(() => {
  vi.clearAllMocks()
  customerRepository.visits.mockResolvedValue(VISITS)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('CustomerHistory', () => {
  it('loads the visits of that customer and lists them newest first with rep, location match, photos and orders', async () => {
    await show()
    expect(customerRepository.visits).toHaveBeenCalledWith('biz-1', CUSTOMER.key)
    const text = document.body.textContent
    expect(text).toContain('Allen Pharmacy')
    expect(text.indexOf('Ada Rep')).toBeLessThan(text.indexOf('Bola'))
    expect(text).toContain('Location matches')
    expect(text).toContain('2 photos')
    expect(text).toContain('Order ORD-1 · Delivered')
    expect(text).toContain('No order from this visit')
  })

  it('shows loading, then an error with a retry', async () => {
    customerRepository.visits.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => { root.render(<CustomerHistory businessId='biz-1' customer={CUSTOMER} onClose={vi.fn()} />) })
    expect(document.body.textContent).toMatch(/loading visits/i)
    await act(async () => { root.render(<></>) })
    customerRepository.visits.mockRejectedValueOnce(new Error('timeout'))
    await show()
    expect(document.body.textContent).toMatch(/could not load the visits: timeout/i)
    await act(async () => { button('Try again').click() })
    await flush()
    expect(document.body.textContent).toContain('Ada Rep')
  })

  it('no visits it can show says so', async () => {
    customerRepository.visits.mockResolvedValue([])
    await show()
    expect(document.body.textContent).toContain('No visits you can see.')
  })
})
