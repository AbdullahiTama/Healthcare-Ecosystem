import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../checkins/repositories', () => ({ checkinRepository: { overview: vi.fn() } }))
vi.mock('../../live-activity/repositories', () => ({ liveActivityRepository: { getFieldActivities: vi.fn() } }))
vi.mock('../../orders/repositories', () => ({ orderRepository: { listAwaitingApproval: vi.fn() } }))
vi.mock('../../../lib/places.js', () => ({ getRepAddedFacilities: vi.fn() }))
vi.mock('../../live-activity/customers/repository.js', () => ({ customerRepository: { list: vi.fn() } }))

import FieldTeamToday from '../FieldTeamToday.jsx'
import { checkinRepository } from '../../checkins/repositories'
import { liveActivityRepository } from '../../live-activity/repositories'
import { orderRepository } from '../../orders/repositories'
import { getRepAddedFacilities } from '../../../lib/places.js'
import { customerRepository } from '../../live-activity/customers/repository.js'

const BRAND = { id: 'biz-1', business_type: 'manufacturer_importer' }
const NOW = new Date(2026, 9, 23, 12, 0, 0).getTime()
const ago = (m) => new Date(NOW - m * 60000).toISOString()

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
async function show(props = {}) {
  await act(async () => { root.render(<MemoryRouter><FieldTeamToday brand={BRAND} role='Owner' customRoles={{}} now={NOW} {...props} /></MemoryRouter>) })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  checkinRepository.overview.mockResolvedValue({ rows: [
    { staff_id: 's1', name: 'Ada Okafor', role: 'Medical sales rep', last_checkin: { at: ago(20), location_label: 'Ikeja' } },
    { staff_id: 's2', name: 'Fatima Sani', role: 'Medical sales rep', last_checkin: null },
  ] })
  liveActivityRepository.getFieldActivities.mockResolvedValue([{ id: 'v1', rep_name: 'Ada Okafor', created_at: ago(10), facility_name: 'Allen Pharmacy', facility_verified: true }])
  orderRepository.listAwaitingApproval.mockResolvedValue([{ id: 'o1' }])
  getRepAddedFacilities.mockResolvedValue([])
  customerRepository.list.mockResolvedValue([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('FieldTeamToday', () => {
  it('shows customers going quiet with a link to Customers filtered to 30 days', async () => {
    customerRepository.list.mockResolvedValue([{ key: 'a', last_visit_at: ago(60 * 24 * 40) }, { key: 'b', last_visit_at: ago(60 * 24 * 35) }, { key: 'c', last_visit_at: ago(30) }])
    await show()
    expect(customerRepository.list).toHaveBeenCalledWith('biz-1', { quietDays: 30 })
    expect(host.textContent).toContain('2 customers not visited in 30 days')
    const link = [...host.querySelectorAll('a')].find((a) => a.textContent.includes('not visited in 30 days'))
    expect(link.getAttribute('href')).toBe('/dashboard/field-team/customers?notVisited=30')
  })

  it('at the limit the count says "500+" rather than a number that may be too low', async () => {
    customerRepository.list.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ key: 'k' + i, last_visit_at: ago(60 * 24 * 40) })))
    await show()
    expect(host.textContent).toContain('500+ customers not visited in 30 days')
  })

  it('one quiet customer reads in the singular', async () => {
    customerRepository.list.mockResolvedValue([{ key: 'a', last_visit_at: ago(60 * 24 * 40) }])
    await show()
    expect(host.textContent).toContain('1 customer not visited in 30 days')
  })

  it('when customers cannot be loaded (or are not available yet) the tile is left out and the rest still shows', async () => {
    customerRepository.list.mockRejectedValue(Object.assign(new Error('Customers are not available yet.'), { code: 'NOT_AVAILABLE' }))
    await show()
    expect(host.textContent).not.toMatch(/not visited in 30 days/)
    expect(host.textContent).toContain('1 visit today')
  })

  it('a slower, older load never overwrites a newer one (e.g. the company changes while loading)', async () => {
    let releaseOld
    checkinRepository.overview
      .mockImplementationOnce(() => new Promise((r) => { releaseOld = () => r({ rows: [{ staff_id: 'x', name: 'Old Company Rep', role: 'Medical sales rep', last_checkin: null }] }) }))
      .mockResolvedValueOnce({ rows: [{ staff_id: 'y', name: 'New Company Rep', role: 'Medical sales rep', last_checkin: null }] })
    await act(async () => { root.render(<MemoryRouter><FieldTeamToday brand={BRAND} role='Owner' customRoles={{}} now={NOW} /></MemoryRouter>) })
    await show({ brand: { id: 'biz-2', business_type: 'manufacturer_importer' } })
    expect(host.textContent).toContain('New Company Rep')
    await act(async () => { releaseOld() })
    await flush(); await flush()
    expect(host.textContent).toContain('New Company Rep')
    expect(host.textContent).not.toContain('Old Company Rep')
  })

  it('a rep who checked out is shown as checked out, and not counted as checked in', async () => {
    checkinRepository.overview.mockResolvedValue({ rows: [
      { staff_id: 's1', name: 'Ada Okafor', role: 'Medical sales rep', last_checkin: { event_type: 'workday_checkout', at: ago(30), location_label: 'Ikeja' } },
    ] })
    await show()
    expect(host.textContent).toContain('0 of 1')
    expect(host.textContent).toMatch(/checked out/i)
    expect(host.textContent).not.toMatch(/old position/i)
  })

  it('shows a loading state first', async () => {
    checkinRepository.overview.mockImplementation(() => new Promise(() => {}))
    await act(async () => { root.render(<MemoryRouter><FieldTeamToday brand={BRAND} role='Owner' customRoles={{}} now={NOW} /></MemoryRouter>) })
    expect(host.textContent).toMatch(/loading field team/i)
  })

  it('shows the counts, who checked in (and who has not), and today\'s visits', async () => {
    await show()
    expect(host.textContent).toContain('1 of 2')
    expect(host.textContent).toMatch(/checked in/i)
    expect(host.textContent).toContain('1 visit today')
    expect(host.textContent).toContain('1 order to approve')
    expect(host.textContent).toContain('0 places to confirm')
    expect(host.textContent).toContain('Ada Okafor')
    expect(host.textContent).toContain('Ikeja')
    expect(host.textContent).toMatch(/Fatima Sani.*not checked in/i)
    expect(host.textContent).toContain('Allen Pharmacy')
  })

  it('asks for today\'s visits only, and for orders waiting on this person', async () => {
    await show()
    const since = new Date(NOW); since.setHours(0, 0, 0, 0)
    expect(liveActivityRepository.getFieldActivities).toHaveBeenCalledWith('biz-1', expect.objectContaining({ since: since.toISOString() }))
    expect(orderRepository.listAwaitingApproval).toHaveBeenCalledWith('biz-1', { approverStaffId: null, isOwner: true })
  })

  it('links to the full Team reports and Team check-ins pages', async () => {
    await show()
    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/dashboard/field-team/reports')
    expect(hrefs).toContain('/dashboard/field-team/checkins')
  })

  it('a quiet day says so in plain words', async () => {
    checkinRepository.overview.mockResolvedValue({ rows: [{ staff_id: 's2', name: 'Fatima Sani', role: 'Medical sales rep', last_checkin: null }] })
    liveActivityRepository.getFieldActivities.mockResolvedValue([])
    await show()
    expect(host.textContent).toContain('No check-ins yet today')
    expect(host.textContent).toContain('No visits yet today')
  })

  it('a company with no field reps yet is told how to add them', async () => {
    checkinRepository.overview.mockResolvedValue({ rows: [] })
    await show()
    expect(host.textContent).toMatch(/no field reps yet/i)
  })

  it('when check-ins cannot be loaded the visits still show, with the reason and Try again', async () => {
    checkinRepository.overview.mockRejectedValueOnce(new Error('Manager access required'))
    await show()
    expect(host.querySelector('[role="alert"]').textContent).toContain('Manager access required')
    expect(host.textContent).toContain('Allen Pharmacy')
    await act(async () => { button('Try again').click() })
    await flush(); await flush()
    expect(checkinRepository.overview).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('Ada Okafor')
  })

  it('when visits cannot be loaded the check-ins still show', async () => {
    liveActivityRepository.getFieldActivities.mockRejectedValue(new Error('offline'))
    await show()
    expect(host.textContent).toContain('Ada Okafor')
    expect(host.querySelector('[role="alert"]').textContent).toContain('offline')
  })
})
