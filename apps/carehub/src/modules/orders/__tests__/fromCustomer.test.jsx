import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// "Raise order" from My customers opens the order form with the customer filled in. Unlike an order raised from a
// report, it is NOT linked to any visit (an old visit did not produce this order).

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repositories', () => ({
  orderRepository: {
    getAll: vi.fn(), listAwaitingApproval: vi.fn(), getItems: vi.fn(), getWatchers: vi.fn(), getFiles: vi.fn(),
    getEvents: vi.fn(), advance: vi.fn(), create: vi.fn(), uploadFile: vi.fn(),
  },
}))
vi.mock('../../warehouses/repositories', () => ({ warehouseRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../staff/repositories', () => ({ staffRepository: { getAll: vi.fn(async () => [{ id: 'mgr', full_name: 'Mo Manager', role: 'Regional Manager' }]) } }))

import Orders from '../Orders.jsx'
import { orderRepository as repo } from '../repositories'

let root, host, lastState
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const input = (placeholder) => [...host.querySelectorAll('input')].find((i) => (i.getAttribute('placeholder') || '').startsWith(placeholder))
const setValue = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
function StateProbe() { lastState = useLocation().state; return null }
// As App.jsx does: the whole tree remounts on every navigation (<Routes key={location.key}>).
let navigations
function Keyed() {
  const location = useLocation()
  navigations.push(location.key)
  return (
    <Routes key={location.key}>
      <Route path='/dashboard/orders' element={<><Orders brand={{ id: 'biz-1' }} /><StateProbe /></>} />
    </Routes>
  )
}

async function open(state) {
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: { id: 'rep', full_name: 'Ada Rep', role: 'Field Rep' }, brand: { id: 'biz-1', owner: 'Boss' } }))
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[{ pathname: '/dashboard/orders', state }]}>
        <Keyed />
      </MemoryRouter>
    )
  })
  await flush(); await flush()
}
const CUSTOMER = { fromCustomer: { customer_name: 'Allen Pharmacy', customer_address: '1 Marina, Lagos' } }

async function completeAndSubmit() {
  await act(async () => { button('Mo Manager').click() })
  await setValue(input('Product name'), 'Amoxil 500mg')
  await setValue(input('Qty'), '10')
  await act(async () => { button('Submit for Approval').click() })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  lastState = undefined
  navigations = []
  vi.spyOn(window.history, 'replaceState')
  repo.getAll.mockResolvedValue([])
  repo.getItems.mockResolvedValue([])
  repo.getWatchers.mockResolvedValue([])
  repo.getFiles.mockResolvedValue([])
  repo.create.mockResolvedValue({ id: 'o1' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks() })

describe('an order started from My customers', () => {
  it('opens the order form with the customer and address, and says who it is for', async () => {
    await open(CUSTOMER)
    expect(host.textContent).toContain('New Order')
    expect(input('e.g. St. Kizito').value).toBe('Allen Pharmacy')
    expect(input('Where it is going').value).toBe('1 Marina, Lagos')
    expect(host.textContent).toContain('For Allen Pharmacy.')
    expect(host.textContent).not.toMatch(/from your visit/i)
  })

  it('the submitted order carries the customer but no visit link', async () => {
    await open(CUSTOMER)
    await completeAndSubmit()
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.create.mock.calls[0][0]).toMatchObject({ customer_name: 'Allen Pharmacy', customer_address: '1 Marina, Lagos' })
    expect(repo.create.mock.calls[0][0]).not.toHaveProperty('field_activity_id')
  })

  it('the customer is used once: the browser entry is cleared (so a refresh does not reopen the form) without a navigation that would remount the page', async () => {
    await open(CUSTOMER)
    expect(window.history.replaceState).toHaveBeenCalled()
    const [state] = window.history.replaceState.mock.calls.at(-1)
    expect(state && state.usr).toBeNull()
    expect(new Set(navigations).size).toBe(1)
    expect(input('e.g. St. Kizito').value).toBe('Allen Pharmacy')
  })

  it('an ordinary new order carries no visit link', async () => {
    await open(undefined)
    await act(async () => { button('New Order').click() })
    await setValue(input('e.g. St. Kizito'), 'Mercy Clinic')
    await completeAndSubmit()
    expect(repo.create.mock.calls[0][0]).not.toHaveProperty('field_activity_id')
  })
})
