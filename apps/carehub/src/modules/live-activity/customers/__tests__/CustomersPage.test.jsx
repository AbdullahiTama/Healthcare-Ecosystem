import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Field team > Customers: every place the team has visited, when and by whom, and what it ordered.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repository.js', () => ({ customerRepository: { list: vi.fn(), visits: vi.fn() } }))
vi.mock('../../../territories/repositories', () => ({ territoryRepository: { getAll: vi.fn() } }))
vi.mock('../../../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))

import CustomersPage from '../CustomersPage.jsx'
import { customerRepository } from '../repository.js'
import { territoryRepository } from '../../../territories/repositories'
import { staffRepository } from '../../../staff/repositories'

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString()
const row = (key, over = {}) => ({
  key, kind: 'facility', name: 'Place ' + key, address: 'Somewhere', territory_id: null, rep_staff_ids: ['r1'],
  last_visit_at: daysAgo(2), last_visit_rep: 'Ada Rep', visits_total: 3, visits_30d: 1,
  last_order_ref: null, last_order_status: null, ...over,
})
const ROWS = [
  row('a', { name: 'Allen Pharmacy', address: '1 Marina', territory_id: 't1', last_order_ref: 'ORD-1', last_order_status: 'approved' }),
  row('d:9', { kind: 'directory', name: 'Mercy Clinic', territory_id: 't2', rep_staff_ids: ['r2'], last_visit_at: daysAgo(40), last_visit_rep: 'Bola', visits_total: 1, visits_30d: 0 }),
]

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))
const select = (label) => host.querySelector(`select[aria-label="${label}"]`)
const change = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
async function show(path = '/dashboard/field-team/customers') {
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><CustomersPage brand={{ id: 'biz-1' }} /></MemoryRouter>) })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  customerRepository.list.mockResolvedValue(ROWS)
  customerRepository.visits.mockResolvedValue([])
  territoryRepository.getAll.mockResolvedValue([{ id: 't1', name: 'Lagos Island' }, { id: 't2', name: 'Mainland' }])
  staffRepository.getAll.mockResolvedValue([{ id: 'r1', full_name: 'Ada Rep' }, { id: 'r2', full_name: 'Bola' }])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Customers page', () => {
  it('shows a loading state first', async () => {
    customerRepository.list.mockImplementation(() => new Promise(() => {}))
    await act(async () => { root.render(<MemoryRouter><CustomersPage brand={{ id: 'biz-1' }} /></MemoryRouter>) })
    expect(host.textContent).toMatch(/loading customers/i)
  })

  it('lists the team\'s customers with kind, last visit, visit counts and the last order', async () => {
    await show()
    expect(customerRepository.list).toHaveBeenCalledWith('biz-1', { quietDays: null })
    const text = host.textContent
    expect(text).toContain('Allen Pharmacy')
    expect(text).toContain('Map')
    expect(text).toContain('Directory')
    expect(text).toContain('2 days ago · Ada Rep')
    expect(text).toContain('3 visits · 1 in 30 days')
    expect(text).toContain('Order ORD-1 · Approved')
    expect(text).toContain('Lagos Island')
  })

  it('search, territory, rep and "not visited in" narrow the list', async () => {
    await show()
    await change(host.querySelector('input[aria-label="Search customers"]'), 'mercy')
    expect(host.textContent).not.toContain('Allen Pharmacy')
    expect(host.textContent).toContain('Mercy Clinic')
    await change(host.querySelector('input[aria-label="Search customers"]'), '')
    await change(select('Territory'), 't1')
    expect(host.textContent).toContain('Allen Pharmacy')
    expect(host.textContent).not.toContain('Mercy Clinic')
    await change(select('Territory'), '')
    await change(select('Rep'), 'r2')
    expect(host.textContent).not.toContain('Allen Pharmacy')
    await change(select('Rep'), '')
    await change(select('Not visited in'), '30')
    expect(host.textContent).not.toContain('Allen Pharmacy')
    expect(host.textContent).toContain('Mercy Clinic')
  })

  it('choosing "not visited in" asks the database for those customers, so none are lost to the 500 limit', async () => {
    await show()
    expect(customerRepository.list).toHaveBeenLastCalledWith('biz-1', { quietDays: null })
    await change(select('Not visited in'), '60')
    await flush()
    expect(customerRepository.list).toHaveBeenLastCalledWith('biz-1', { quietDays: 60 })
  })

  it('?notVisited=30 opens with that filter on', async () => {
    await show('/dashboard/field-team/customers?notVisited=30')
    expect(customerRepository.list).toHaveBeenCalledWith('biz-1', { quietDays: 30 })
    expect(select('Not visited in').value).toBe('30')
    expect(host.textContent).not.toContain('Allen Pharmacy')
  })

  it('an unknown ?notVisited value is ignored', async () => {
    await show('/dashboard/field-team/customers?notVisited=7')
    expect(select('Not visited in').value).toBe('0')
  })

  it('no customers yet says how a customer appears', async () => {
    customerRepository.list.mockResolvedValue([])
    await show()
    expect(host.textContent).toContain('No customers yet. A customer appears when a rep chooses the place while logging a visit.')
  })

  it('filters that match nothing say so', async () => {
    await show()
    await change(host.querySelector('input[aria-label="Search customers"]'), 'zzz')
    expect(host.textContent).toContain('No customers match these filters.')
  })

  it('before the database part is applied it says customers are not available yet, with no retry', async () => {
    customerRepository.list.mockRejectedValue(Object.assign(new Error('Customers are not available yet.'), { code: 'NOT_AVAILABLE' }))
    await show()
    expect(host.textContent).toContain('Customers are not available yet.')
    expect(button('Try again')).toBeUndefined()
  })

  it('another failure offers a retry that loads again', async () => {
    customerRepository.list.mockRejectedValueOnce(new Error('timeout'))
    await show()
    expect(host.textContent).toMatch(/could not load customers: timeout/i)
    await act(async () => { button('Try again').click() })
    await flush()
    expect(customerRepository.list).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('Allen Pharmacy')
  })

  it('at the 500 limit it says only the most recent are shown', async () => {
    customerRepository.list.mockResolvedValue(Array.from({ length: 500 }, (_, i) => row('k' + i)))
    await show()
    expect(host.textContent).toContain('Showing the 500 most recently visited customers.')
  })

  it('opening a customer shows its history', async () => {
    await show()
    await act(async () => { button('Allen Pharmacy').click() })
    await flush()
    expect(customerRepository.visits).toHaveBeenCalledWith('biz-1', 'a')
  })
})
