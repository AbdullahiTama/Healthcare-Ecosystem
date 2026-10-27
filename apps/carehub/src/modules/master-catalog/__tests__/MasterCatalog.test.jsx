import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// The Master Catalog screen (catalogue phase 1): the business's product list, searched and filtered on the server,
// carried at locations in bulk, pushed by id, archived instead of deleted. It must show loading, a retryable error and
// the right empty state, and respect an expired plan.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const plan = vi.hoisted(() => ({ state: 'active' }))
vi.mock('../repositories', () => ({
  PAGE_SIZE: 50,
  masterCatalogRepository: { getPage: vi.fn(), getCategories: vi.fn(), carry: vi.fn(), push: vi.fn(), archive: vi.fn(), restore: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn() },
}))
vi.mock('../../locations/repositories', () => ({ locationsRepository: { getAll: vi.fn() } }))
vi.mock('../../settings/repositories', () => ({ settingsRepository: { getPlanStatus: vi.fn(async () => ({ plan: 'growth', state: plan.state, limits: {} })) } }))

import MasterCatalog from '../MasterCatalog.jsx'
import { PlanStatusProvider } from '../../../hooks/usePlanStatus.jsx'
import { masterCatalogRepository as repo } from '../repositories'
import { locationsRepository } from '../../locations/repositories'

const MAIN = { id: 'main', name: 'Allen Pharmacy', parent_business_id: null, plan_expires_at: '2027-01-01T00:00:00Z' }
const YABA = { id: 'yaba', branch_name: 'Yaba', parent_business_id: 'main' }
const AMOXIL = { id: 'm1', name: 'Amoxil 500', generic_name: 'Amoxicillin', category_code: 'antibiotics', rx_status: 'prescription_only', default_price: 1200,
  carried: [{ branch_id: 'main', product_id: 'p1', price: 1200, stock: 8, price_source: 'master', active: true }] }
const PCM = { id: 'm2', name: 'Paracetamol 500mg', category_code: 'analgesics', rx_status: 'otc', default_price: 500, carried: [] }

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const button = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
async function show(role = 'Owner') {
  await act(async () => {
    root.render(<MemoryRouter><PlanStatusProvider brand={MAIN}><MasterCatalog brand={MAIN} role={role} /></PlanStatusProvider></MemoryRouter>)
  })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  plan.state = 'active'
  repo.getPage.mockResolvedValue({ items: [AMOXIL, PCM], total: 2, upgraded: true })
  repo.getCategories.mockResolvedValue([{ code: 'antibiotics', label: 'Antibiotics', rx_default: 'prescription_only' }, { code: 'analgesics', label: 'Pain relief', rx_default: 'otc' }])
  repo.carry.mockResolvedValue(1)
  repo.push.mockResolvedValue(3)
  repo.archive.mockResolvedValue(null)
  locationsRepository.getAll.mockResolvedValue([MAIN, YABA])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('MasterCatalog', () => {
  it('lists items with category, prescription status and where each is carried', async () => {
    await show()
    expect(repo.getPage).toHaveBeenCalledWith('main', expect.objectContaining({ search: '', offset: 0, limit: 50 }))
    expect(text()).toContain('Amoxil 500')
    expect(text()).toContain('Antibiotics')
    expect(text()).toContain('Prescription only')
    expect(text()).toContain('Main Location · ₦1,200 · 8 in stock')
    expect(text()).toContain('Carried at 1 of 2 locations')
    expect(text()).toContain('Not carried at any location')
  })

  it('shows a retryable error instead of an empty list', async () => {
    repo.getPage.mockRejectedValueOnce(new Error('Supabase error (500): down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await show()
    expect(document.body.querySelector('[role="alert"]').textContent).toContain("couldn't load the catalogue")
    await click(button('Try again') || [...document.body.querySelectorAll('[role="alert"] button')][0])
    expect(text()).toContain('Amoxil 500')
  })

  it('an empty catalogue explains that products join automatically', async () => {
    repo.getPage.mockResolvedValue({ items: [], total: 0, upgraded: true })
    await show()
    expect(text()).toContain('Your catalogue is empty')
    expect(text()).toContain('appear here automatically')
  })

  it('searches on the server after a pause in typing', async () => {
    await show()
    const box = document.body.querySelector('input[type="search"]')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'amox'); box.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    await flush()
    expect(repo.getPage).toHaveBeenLastCalledWith('main', expect.objectContaining({ search: 'amox', offset: 0 }))
  })

  it('carries the selected items at the chosen locations in one call per location', async () => {
    await show()
    await act(async () => { document.body.querySelector('input[aria-label="Select Amoxil 500"]').click() })
    await act(async () => { document.body.querySelector('input[aria-label="Select Paracetamol 500mg"]').click() })
    expect(text()).toContain('2 selected')
    await click(button('Carry at locations'))
    const yaba = [...document.body.querySelectorAll('label')].find((l) => l.textContent.includes('Yaba')).querySelector('input')
    await act(async () => { yaba.click() })
    await click(button('Carry'))
    expect(repo.carry).toHaveBeenCalledTimes(1)
    expect(repo.carry).toHaveBeenCalledWith('yaba', ['m1', 'm2'], null)
    expect(text()).toContain('2 items carried at 1 location.')
  })

  it('push asks first, then reports how many products were updated', async () => {
    await show()
    await click(button('Push Amoxil 500 to every location'))
    expect(text()).toContain('locations with their own price keep it')
    await click([...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Push').pop())
    expect(repo.push).toHaveBeenCalledWith('m1', 'main')
    expect(text()).toContain('Amoxil 500 updated at 3 products')
  })

  it('archives instead of deleting, after confirmation', async () => {
    await show()
    await click(button('Archive Amoxil 500'))
    expect(text()).toContain('Locations keep their products, stock and history')
    await click([...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Archive').pop())
    expect(repo.archive).toHaveBeenCalledWith('m1', 'main')
  })

  it('an expired plan pauses adding and carrying, with the reason', async () => {
    plan.state = 'restricted'
    await show()
    await click(button('+ Add item'))
    expect(text()).toContain('plan has expired')
    expect(document.body.querySelector('#mc-name')).toBeNull()
  })

  it('before the catalogue update, the plain list shows with a notice and no filters', async () => {
    repo.getPage.mockResolvedValue({ items: [{ id: 'm2', name: 'Paracetamol 500mg', default_price: 500, carried: [] }], total: 1, upgraded: false })
    repo.getCategories.mockResolvedValue([])
    await show()
    expect(text()).toContain('once the catalogue update is installed')
    expect(document.body.querySelector('#mc-filter-category').disabled).toBe(true)
    expect(document.body.querySelector('input[aria-label="Select Paracetamol 500mg"]')).toBeTruthy()
  })

  it('is managed by the owner only', async () => {
    await show('Cashier')
    expect(text()).toContain('managed by the business owner')
    expect(repo.getPage).not.toHaveBeenCalled()
  })
})
