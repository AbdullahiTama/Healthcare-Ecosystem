import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// My customers on the rep's Field page: going back to a customer starts a normal visit report with the place
// already chosen. The GPS fix is still taken and judged as usual; a remembered place is never proof of a visit.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: {
    getActivityFields: vi.fn(), getFieldActivities: vi.fn(), countFieldActivities: vi.fn(),
    getActivityViewers: vi.fn(), getActivityReactions: vi.fn(), getActivityComments: vi.fn(),
    getDefaultViewers: vi.fn(), logActivity: vi.fn(), notifyViewers: vi.fn(),
    lookupArea: vi.fn(), uploadActivityVoice: vi.fn(), getAllFieldActivities: vi.fn(),
  },
}))
vi.mock('./customers/repository.js', () => ({ customerRepository: { list: vi.fn(), visits: vi.fn() } }))
vi.mock('../business-directory/suggestions/repository.js', () => ({ SUGGESTION_TYPES: [['retail', 'Retail shop']], suggestionRepository: { listMine: vi.fn(), create: vi.fn() } }))
vi.mock('../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn() } }))
vi.mock('../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))
vi.mock('../../lib/realtime', () => ({ watchTable: vi.fn(() => () => {}), subscribeChanges: vi.fn(() => () => {}) }))
vi.mock('../checkins/CheckInPanel.jsx', () => ({ default: () => null }))
vi.mock('../../lib/places.js', () => ({
  FACILITY_FILTERS: [], nearbyHealthFacilities: vi.fn(async () => ({ facilities: [], fromCache: false })),
  getRepAddedFacilities: vi.fn(async () => []), confirmRepAddedFacility: vi.fn(), dismissRepAddedFacility: vi.fn(), addRepAddedFacility: vi.fn(),
}))
vi.mock('../business-directory/components/NearbyBusinessPicker', () => ({ default: ({ selected }) => (selected ? <div data-testid='chosen-business'>{selected.name}</div> : null) }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(async () => []), sbUpload: vi.fn() }))

import LiveActivity from './LiveActivity.jsx'
import { liveActivityRepository as repo } from './repositories'
import { customerRepository } from './customers/repository.js'
import { suggestionRepository } from '../business-directory/suggestions/repository.js'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'

const BRAND = { id: 'brand-1' }
const STAFF = { id: 'staff-1', full_name: 'Ada Rep', role: 'Sales Rep', email: 'ada@a.test' }
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString()
// About 2 km north of where the phone is (6.5, 3.4).
const FAR = { key: 'f:allen@6.518,3.400', kind: 'facility', name: 'Allen Pharmacy', address: '1 Marina', category: 'pharmacy', lat: 6.518, lng: 3.4, source: 'detected', last_visit_at: daysAgo(3), visits_total: 2, visits_30d: 2 }
const NEAR_ADDED = { ...FAR, key: 'f:kemi@6.500,3.400', name: 'Kemi Stores', lat: 6.5001, lng: 3.4001, source: 'rep_added' }
const DIRECTORY = { key: 'd:9', kind: 'directory', directory_business_id: '9', name: 'Mercy Clinic', last_visit_at: daysAgo(1), visits_total: 1, visits_30d: 1 }

let root, host, lastLocation
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async () => { await flush(); await flush(); await flush() }
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const rowButton = (name, text) => {
  const li = [...host.querySelectorAll('li')].find((x) => x.textContent.includes(name))
  return [...li.querySelectorAll('button')].find((b) => b.textContent === text)
}
function Probe() { lastLocation = useLocation(); return <div data-testid='orders-page' /> }

async function render(mode) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard/activity']}>
        <Routes>
          <Route path='/dashboard/activity' element={<LiveActivity brand={BRAND} mode={mode} />} />
          <Route path='/dashboard/orders' element={<Probe />} />
        </Routes>
      </MemoryRouter>
    )
  })
  await settle()
}
async function openMyCustomers() {
  await render()
  await act(async () => { button('My customers').click() })
  await settle()
}
async function logVisitAt(name) {
  await act(async () => { rowButton(name, 'Log a visit here').click() })
  await settle()
  const note = host.querySelector('[role="dialog"] textarea')
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Called on the pharmacist'); note.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { button('Log It').click() })
  await flush()
  return repo.logActivity.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('carehub_auth', JSON.stringify({ staff: STAFF, brand: { id: BRAND.id, owner: 'Boss' } }))
  Object.defineProperty(globalThis.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 15 } })) } })
  repo.getActivityFields.mockResolvedValue([])
  repo.getFieldActivities.mockResolvedValue([])
  repo.countFieldActivities.mockResolvedValue(0)
  repo.getActivityViewers.mockResolvedValue([])
  repo.getActivityReactions.mockResolvedValue([])
  repo.getActivityComments.mockResolvedValue([])
  repo.getDefaultViewers.mockResolvedValue([])
  repo.logActivity.mockResolvedValue({ id: 'x', notification: 'none' })
  repo.lookupArea.mockResolvedValue({ status: 'ok', label: 'Allen Avenue, Ikeja' })
  customerRepository.list.mockResolvedValue([DIRECTORY, FAR, NEAR_ADDED])
  suggestionRepository.listMine.mockResolvedValue([{ id: 's1', name: 'Kemi Stores', status: 'pending' }])
  suggestionRepository.create.mockResolvedValue({ id: 's2', status: 'pending' })
  territoryRepository.getAll.mockResolvedValue([])
  staffRepository.getAll.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear() })

describe('suggesting a missing business', () => {
  it('My customers shows their own suggestions below the list', async () => {
    await openMyCustomers()
    expect(suggestionRepository.listMine).toHaveBeenCalledWith('ada@a.test')
    expect(host.textContent).toContain('Your suggestions')
    expect(host.textContent).toContain('Waiting for review')
  })

  it('the log form offers to suggest a business, pre-filled with the area, sent with the position, report unaffected', async () => {
    await render()
    await act(async () => { button('Log Activity').click() })
    await settle()
    await act(async () => { button('Business not in the CareHub directory? Suggest it').click() })
    const name = host.querySelector('[aria-label="Business name"]')
    expect(host.querySelector('[aria-label="Address"]').value).toBe('Allen Avenue, Ikeja')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Kemi Stores'); name.dispatchEvent(new Event('input', { bubbles: true })) })
    const type = host.querySelector('[aria-label="Type"]')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(type, 'retail'); type.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { button('Send suggestion').click() })
    await flush()
    expect(suggestionRepository.create).toHaveBeenCalledWith('brand-1', expect.objectContaining({ name: 'Kemi Stores', business_type: 'retail', latitude: 6.5, longitude: 3.4 }))
    expect(host.textContent).toContain('Thanks. The CareHub team will review it.')
    expect(repo.logActivity).not.toHaveBeenCalled()
  })
})

describe('My customers on the Field page', () => {
  it('a staff member gets the tab, and it lists their own customers', async () => {
    await openMyCustomers()
    expect(customerRepository.list).toHaveBeenCalledWith('brand-1', { staffId: 'staff-1' })
    expect(host.textContent).toContain('Allen Pharmacy')
    expect(button('Feed')).toBeUndefined()
  })

  it('the owner (no staff record) does not get the tab; they use Field team > Customers', async () => {
    localStorage.setItem('carehub_auth', JSON.stringify({ brand: { id: BRAND.id, owner: 'Boss' } }))
    await render()
    expect(button('My customers')).toBeUndefined()
  })

  it('there is no My customers tab on the team page', async () => {
    await render('team')
    expect(button('My customers')).toBeUndefined()
  })

  it('Log a visit here at a place 2 km away saves it as the target, takes the GPS fix, and does NOT verify it', async () => {
    await openMyCustomers()
    const saved = await logVisitAt('Allen Pharmacy')
    expect(saved.facility_name).toBe('Allen Pharmacy')
    expect(saved.facility_source).toBe('detected')
    expect(saved.lat).toBe(6.5)
    expect(saved.facility_verified).toBe(false)
    expect(saved.facility_distance_m).toBeGreaterThan(1500)
  })

  it('a place a rep added is saved as pending review even when the phone is right there', async () => {
    await openMyCustomers()
    const saved = await logVisitAt('Kemi Stores')
    expect(saved.facility_verified).toBe(false)
    expect(saved.facility_pending_review).toBe(true)
    expect(saved.facility_source).toBe('rep_added')
  })

  it('a directory customer is saved as the directory business', async () => {
    await openMyCustomers()
    const saved = await logVisitAt('Mercy Clinic')
    expect(saved.directory_business_id).toBe('9')
    expect(saved.directory_business_name).toBe('Mercy Clinic')
    expect(saved.facility_name).toBeNull()
  })

  it('Raise order opens Orders with the customer, not linked to any visit', async () => {
    await openMyCustomers()
    await act(async () => { rowButton('Allen Pharmacy', 'Raise order').click() })
    await settle()
    expect(lastLocation.pathname).toBe('/dashboard/orders')
    expect(lastLocation.state).toEqual({ fromCustomer: { customer_name: 'Allen Pharmacy', customer_address: '1 Marina' } })
  })
})
