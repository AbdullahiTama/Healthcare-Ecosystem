import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// A rep takes an order during a visit: "Raise order" on their own report opens the order form for that customer,
// and the report then shows the order it produced (owner's choice, field team reorganisation).

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), reverseGeocode: vi.fn(), uploadActivityVoice: vi.fn(), getAllFieldActivities: vi.fn(),
  },
}))
vi.mock('../orders/repositories', () => ({ orderRepository: { listForActivities: vi.fn() } }))
vi.mock('../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn() } }))
vi.mock('../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}), subscribeChanges: vi.fn(() => () => {}) }))
vi.mock('../checkins/CheckInPanel.jsx', () => ({ default: () => null }))
vi.mock('../../lib/places.js', () => ({
  FACILITY_FILTERS: [], nearbyHealthFacilities: vi.fn(async () => []), getRepAddedFacilities: vi.fn(async () => []),
  confirmRepAddedFacility: vi.fn(), dismissRepAddedFacility: vi.fn(), addRepAddedFacility: vi.fn(),
}))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))

import LiveActivity from './LiveActivity.jsx'
import { liveActivityRepository as repo } from './repositories'
import { orderRepository } from '../orders/repositories'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const MINE = { id: 'mine', business_id: 'brand-1', staff_id: 'me', rep_name: 'Ada Rep', values_json: '{}', created_at: '2026-10-23T10:00:00Z', facility_name: 'Allen Pharmacy', facility_address: '1 Marina, Lagos' }
const THEIRS = { id: 'theirs', business_id: 'brand-1', staff_id: 'other', rep_name: 'Bayo Rep', values_json: '{}', created_at: '2026-10-23T09:00:00Z', directory_business_name: 'Mercy Clinic' }

let root, host, landed
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const buttons = (text) => [...host.querySelectorAll('button')].filter((b) => b.textContent.trim() === text)
function OrdersProbe() { landed = useLocation(); return <div data-testid='orders-page' /> }

async function show() {
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: { id: 'me', full_name: 'Ada Rep', role: 'Field Rep' }, brand: { id: BRAND.id, owner: 'Boss' } }))
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard/activity']}>
        <Routes>
          <Route path='/dashboard/activity' element={<LiveActivity brand={BRAND} />} />
          <Route path='/dashboard/orders' element={<OrdersProbe />} />
        </Routes>
      </MemoryRouter>
    )
  })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  landed = null
  Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: true })
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([MINE])
  repo.countFieldActivities.mockResolvedValue(1)
  repo.getActivityViewers.mockResolvedValue([{ id: 'v', activity_id: 'theirs', staff_id: 'me', viewer_name: 'Ada Rep' }])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  orderRepository.listForActivities.mockResolvedValue([])
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('raising an order from a visit', () => {
  it('my own report offers Raise order; it opens the order form for that customer, linked to the report', async () => {
    await show()
    expect(buttons('Raise order')).toHaveLength(1)
    await act(async () => { buttons('Raise order')[0].click() })
    await flush()
    expect(landed.pathname).toBe('/dashboard/orders')
    expect(landed.state).toEqual({ fromVisit: { activityId: 'mine', customer_name: 'Allen Pharmacy', customer_address: '1 Marina, Lagos' } })
  })

  it('a colleague\'s report shared with me does not offer it', async () => {
    repo.getFieldActivities.mockResolvedValue([THEIRS])
    await show()
    await act(async () => { buttons('Shared with me')[0].click() })
    await flush()
    expect(host.textContent).toContain('Bayo Rep')
    expect(buttons('Raise order')).toHaveLength(0)
  })

  it('offline, it says an order needs a connection and goes nowhere', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: false })
    await show()
    await act(async () => { buttons('Raise order')[0].click() })
    await flush()
    expect(landed).toBeNull()
    expect(host.textContent).toMatch(/an order needs a connection/i)
  })

  it('a report shows the orders it produced, with their stage', async () => {
    orderRepository.listForActivities.mockResolvedValue([{ id: 'o1', order_ref: 'ORD-12345678', status: 'submitted', field_activity_id: 'mine' }])
    await show()
    expect(orderRepository.listForActivities).toHaveBeenCalledWith('brand-1', ['mine'])
    expect(host.textContent).toContain('ORD-12345678')
    expect(host.textContent).toContain('Awaiting Approval')
  })

  it('if the linked orders cannot be loaded the report still shows', async () => {
    orderRepository.listForActivities.mockRejectedValue(new Error('offline'))
    await show()
    expect(host.textContent).toContain('Ada Rep')
    expect(host.textContent).toContain('Allen Pharmacy')
  })
})
