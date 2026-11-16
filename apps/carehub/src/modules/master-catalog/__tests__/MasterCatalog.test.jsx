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
const lib = vi.hoisted(() => ({ linkMatches: vi.fn(), link: vi.fn(), unlink: vi.fn(), suggest: vi.fn(), search: vi.fn() }))
vi.mock('../../product-library/repositories', () => ({ libraryRepository: lib }))
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
  lib.linkMatches.mockResolvedValue({ matches: [], total: 0, available: false })
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

// Catalogue phase 4: the CareHub product library.
describe('MasterCatalog and the CareHub library', () => {
  const LIB_AMOX = { id: 'c1', brand_name: 'Amoxil', strength: '500mg', generic_name: 'Amoxicillin', dose_form: 'Capsule', barcodes: ['5012345'], category_code: 'antibiotics', rx_status: 'prescription_only' }
  const LIB_PCM = { id: 'c2', brand_name: 'Paracetamol 500mg', rx_status: 'pharmacy_only' }
  const typeInto = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
  const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 300)) })

  beforeEach(() => {
    lib.linkMatches.mockResolvedValue({ available: true, total: 1, matches: [{ master: { id: 'm2', name: 'Paracetamol 500mg', rx_status: 'otc' }, library: LIB_PCM, match_by: 'name' }] })
    lib.link.mockResolvedValue(1)
    lib.search.mockResolvedValue([LIB_AMOX])
    repo.getPage.mockResolvedValue({ items: [{ ...AMOXIL, library: LIB_AMOX }, { ...PCM, suggestion: null }], total: 2, upgraded: true })
  })

  it('hides library features until the library is installed', async () => {
    lib.linkMatches.mockResolvedValue({ matches: [], total: 0, available: false })
    await show()
    expect(button('CareHub library for Amoxil 500')).toBeUndefined()
    expect(text()).not.toContain('match the CareHub product library')
    expect(document.getElementById('mc-filter-library')).toBeNull()
  })

  it('shows linked items, filters by link, and reviews matches in bulk', async () => {
    await show()
    expect(text()).toContain('CareHub library')
    expect(text()).toContain('1 item in your catalogue matches the CareHub product library')
    const filter = document.getElementById('mc-filter-library')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(filter, 'unlinked'); filter.dispatchEvent(new Event('change', { bubbles: true })) })
    await flush()
    expect(repo.getPage).toHaveBeenLastCalledWith('main', expect.objectContaining({ library: 'unlinked' }))

    await click(button('Review matches'))
    expect(text()).toContain('Paracetamol 500mg')
    expect(text()).toContain('Same name and strength')
    expect(text()).toContain('Becomes Pharmacy only (now Over the counter)')
    await click(button('Link 1 item'))
    expect(lib.link).toHaveBeenCalledWith('main', [{ master_product_id: 'm2', catalog_item_id: 'c2' }])
    expect(text()).toContain('1 item linked to the CareHub library.')
  })

  it('links one item from its Library button, or suggests it', async () => {
    lib.search.mockResolvedValue([LIB_PCM])
    await show()
    await click(button('CareHub library for Paracetamol 500mg'))
    await typeInto(document.body.querySelector('input[type="search"][aria-controls]'), 'parac')
    await wait(); await flush()
    await click([...document.body.querySelectorAll('ul[aria-label="Library results"] button')][0])
    expect(text()).toContain('the prescription status becomes at least Pharmacy only')
    await click(button('Link'))
    expect(lib.link).toHaveBeenCalledWith('main', [{ master_product_id: 'm2', catalog_item_id: 'c2' }])

    await click(button('CareHub library for Paracetamol 500mg'))
    await click(button('Suggest it'))
    await typeInto(document.getElementById('suggest-note'), 'Made by Emzor')
    await click(button('Send suggestion'))
    expect(lib.suggest).toHaveBeenCalledWith('main', 'm2', 'Made by Emzor')
    expect(text()).toContain('CareHub will review Paracetamol 500mg')
  })

  it('shows the database refusal when linking fails, and unlinks a linked item', async () => {
    lib.unlink.mockRejectedValueOnce(new Error('Supabase error (403): Only the owner or a manager of the business can change its catalogue.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await show()
    await click(button('CareHub library for Amoxil 500'))
    expect(text()).toContain('Linked to Amoxil 500mg')
    await click(button('Unlink'))
    expect(text()).toContain('Only the owner or a manager of the business can change its catalogue.')
    await click(button('Unlink'))
    expect(lib.unlink).toHaveBeenLastCalledWith('main', 'm1')
    expect(text()).toContain('Amoxil 500 is no longer linked')
  })

  it('starts a new item from the library: details fill in, it is linked, and the status cannot be looser', async () => {
    repo.create.mockResolvedValue([{ id: 'm9' }])
    await show()
    await click(button('+ Add item'))
    await typeInto(document.body.querySelector('input[type="search"][aria-controls]'), 'amox')
    await wait(); await flush()
    await click([...document.body.querySelectorAll('ul[aria-label="Library results"] button')][0])
    expect(text()).toContain('Linked to the CareHub library: Amoxil 500mg')
    expect(document.getElementById('mc-name').value).toBe('Amoxil 500mg')
    expect(document.getElementById('mc-generic').value).toBe('Amoxicillin')
    expect(document.getElementById('mc-barcode').value).toBe('5012345')
    expect([...document.getElementById('mc-rx').options].map((o) => o.value)).toEqual(['', 'prescription_only', 'controlled'])
    await typeInto(document.getElementById('mc-price'), '1500')
    await click(button('Add item'))
    expect(repo.create).toHaveBeenCalledWith('main', expect.objectContaining({ name: 'Amoxil 500mg', catalog_item_id: 'c1', rx_status: 'prescription_only', default_price: 1500 }))
  })
})
