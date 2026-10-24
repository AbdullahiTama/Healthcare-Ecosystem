import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// My customers on the rep's Field page: the places this rep visited, with a quick way back to each.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repository.js', () => ({ customerRepository: { list: vi.fn(), visits: vi.fn() } }))

import MyCustomers from '../MyCustomers.jsx'
import { customerRepository } from '../repository.js'

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString()
const FACILITY = { key: 'f:allen@6.450,3.390', kind: 'facility', name: 'Allen Pharmacy', address: '1 Marina', category: 'pharmacy', lat: 6.45, lng: 3.39, source: 'detected', last_visit_at: daysAgo(3), visits_total: 2, visits_30d: 2, last_order_ref: 'ORD-9', last_order_status: 'submitted' }
const ADDED = { ...FACILITY, key: 'f:kemi@6.5,3.4', name: 'Kemi Stores', source: 'rep_added', last_visit_at: daysAgo(10), last_order_ref: null, last_order_status: null }
const DIRECTORY = { key: 'd:9', kind: 'directory', directory_business_id: '9', name: 'Mercy Clinic', address: null, last_visit_at: daysAgo(1), visits_total: 1, visits_30d: 1 }

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const buttonsIn = (name) => {
  const item = [...host.querySelectorAll('li')].find((li) => li.textContent.includes(name))
  return [...item.querySelectorAll('button')]
}
async function show(props = {}) {
  const onLogVisit = vi.fn()
  const onRaiseOrder = vi.fn()
  await act(async () => { root.render(<MyCustomers brand={{ id: 'biz-1' }} staffId='rep-1' onLogVisit={onLogVisit} onRaiseOrder={onRaiseOrder} {...props} />) })
  await flush(); await flush()
  return { onLogVisit, onRaiseOrder }
}

beforeEach(() => {
  vi.clearAllMocks()
  customerRepository.list.mockResolvedValue([DIRECTORY, FACILITY, ADDED])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('MyCustomers', () => {
  it('loads only this rep\'s customers, newest first, with the last order', async () => {
    await show()
    expect(customerRepository.list).toHaveBeenCalledWith('biz-1', { staffId: 'rep-1' })
    const text = host.textContent
    expect(text.indexOf('Mercy Clinic')).toBeLessThan(text.indexOf('Allen Pharmacy'))
    expect(text).toContain('3 days ago')
    expect(text).toContain('Order ORD-9 · Awaiting Approval')
  })

  it('Log a visit here hands over the place as the visit target, keeping its source', async () => {
    const { onLogVisit } = await show()
    await act(async () => { buttonsIn('Allen Pharmacy').find((b) => b.textContent === 'Log a visit here').click() })
    expect(onLogVisit).toHaveBeenCalledWith({ facility: { name: 'Allen Pharmacy', address: '1 Marina', category: 'pharmacy', lat: 6.45, lng: 3.39, source: 'detected', pendingReview: false } })
  })

  it('a place a rep added (never confirmed) goes back as pending review, so its own position cannot verify it', async () => {
    const { onLogVisit } = await show()
    await act(async () => { buttonsIn('Kemi Stores').find((b) => b.textContent === 'Log a visit here').click() })
    expect(onLogVisit.mock.calls[0][0].facility).toMatchObject({ source: 'rep_added', pendingReview: true })
  })

  it('a directory customer goes back as the directory business', async () => {
    const { onLogVisit } = await show()
    await act(async () => { buttonsIn('Mercy Clinic').find((b) => b.textContent === 'Log a visit here').click() })
    expect(onLogVisit).toHaveBeenCalledWith({ business: { id: '9', name: 'Mercy Clinic' } })
  })

  it('Raise order hands over the customer name and address', async () => {
    const { onRaiseOrder } = await show()
    await act(async () => { buttonsIn('Allen Pharmacy').find((b) => b.textContent === 'Raise order').click() })
    expect(onRaiseOrder).toHaveBeenCalledWith({ customer_name: 'Allen Pharmacy', customer_address: '1 Marina' })
  })

  it('no customers yet says how they appear', async () => {
    customerRepository.list.mockResolvedValue([])
    await show()
    expect(host.textContent).toContain('You have no customers yet. Choose the place when you log a visit and it will appear here.')
  })

  it('loading, then a failure with a retry', async () => {
    customerRepository.list.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => { root.render(<MyCustomers brand={{ id: 'biz-1' }} staffId='rep-1' onLogVisit={vi.fn()} onRaiseOrder={vi.fn()} />) })
    expect(host.textContent).toMatch(/loading your customers/i)
    await act(async () => { root.render(<></>) })
    customerRepository.list.mockRejectedValueOnce(new Error('timeout'))
    await show()
    expect(host.textContent).toMatch(/could not load your customers: timeout/i)
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click() })
    await flush()
    expect(host.textContent).toContain('Allen Pharmacy')
  })

  it('before the database part is applied it says so, with no retry', async () => {
    customerRepository.list.mockRejectedValue(Object.assign(new Error('Customers are not available yet.'), { code: 'NOT_AVAILABLE' }))
    await show()
    expect(host.textContent).toContain('Customers are not available yet.')
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again')).toBeUndefined()
  })
})
