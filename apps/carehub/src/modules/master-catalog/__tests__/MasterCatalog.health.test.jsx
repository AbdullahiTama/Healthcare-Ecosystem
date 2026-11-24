import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Catalogue health (catalogue phase 5) on the Master Catalog screen: the score and its counts, a count filtering the
// list, the duplicates review (merge with confirmation, dismiss, refusals shown), and bulk category. Hidden before the
// migration.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../repositories', () => ({
  PAGE_SIZE: 50,
  masterCatalogRepository: { getPage: vi.fn(), getHealth: vi.fn(), getCategories: vi.fn(), duplicatePairs: vi.fn(), dismissPair: vi.fn(),
    merge: vi.fn(), setCategory: vi.fn(), suggestions: vi.fn(), applyFixes: vi.fn(), dismissSuggestions: vi.fn(), carry: vi.fn(), push: vi.fn(), archive: vi.fn(), restore: vi.fn(), create: vi.fn(), update: vi.fn(), deactivate: vi.fn() },
}))
vi.mock('../../locations/repositories', () => ({ locationsRepository: { getAll: vi.fn() } }))
const lib = vi.hoisted(() => ({ linkMatches: vi.fn(), link: vi.fn(), unlink: vi.fn(), suggest: vi.fn(), search: vi.fn() }))
vi.mock('../../product-library/repositories', () => ({ libraryRepository: lib }))
vi.mock('../../settings/repositories', () => ({ settingsRepository: { getPlanStatus: vi.fn(async () => ({ plan: 'growth', state: 'active', limits: {} })) } }))

import MasterCatalog from '../MasterCatalog.jsx'
import { PlanStatusProvider } from '../../../hooks/usePlanStatus.jsx'
import { masterCatalogRepository as repo } from '../repositories'
import { locationsRepository } from '../../locations/repositories'
import { defaultKeep } from '../DuplicatesModal.jsx'

const MAIN = { id: 'main', name: 'Allen Pharmacy', parent_business_id: null, plan_expires_at: '2027-01-01T00:00:00Z' }
const PAN1 = { id: 'm1', name: 'Panadol Extra', category_code: 'medicines_other', rx_status: 'otc', default_price: 400, carried: [] }
const PAN2 = { id: 'm2', name: 'Panadol-Extra', category_code: 'analgesics', rx_status: 'otc', default_price: 0, carried: [] }
const HEALTH = { available: true, score: 64, total: 2, counts: { no_price: 1, hidden: 0, duplicates: 1, other_category: 1, no_generic: 2, no_barcode: 0, unlinked: 2 } }
const PAIR = {
  a: { id: 'm1', name: 'Panadol Extra', barcode: '6001', default_price: 400, locations: 1, stock: 5, rx_status: 'otc' },
  b: { id: 'm2', name: 'Panadol-Extra', generic_name: 'Paracetamol', default_price: 0, locations: 2, stock: 5, rx_status: 'pharmacy_only' },
  reason: 'name', score: 0.99,
}

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const button = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
const lastButton = (label) => [...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === label).pop()
const buttonStarting = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label))
const click = async (el) => { await act(async () => { el.click() }); await flush() }
async function show() {
  await act(async () => {
    root.render(<MemoryRouter><PlanStatusProvider brand={MAIN}><MasterCatalog brand={MAIN} role='Owner' /></PlanStatusProvider></MemoryRouter>)
  })
  await flush(); await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getPage.mockResolvedValue({ items: [PAN1, PAN2], total: 2, upgraded: true })
  repo.getHealth.mockResolvedValue(HEALTH)
  repo.getCategories.mockResolvedValue([{ code: 'analgesics', label: 'Pain relief', rx_default: 'otc' }, { code: 'medicines_other', label: 'Other medicines', rx_default: 'pharmacy_only' }])
  repo.duplicatePairs.mockResolvedValue({ pairs: [PAIR], total: 1 })
  locationsRepository.getAll.mockResolvedValue([MAIN])
  lib.linkMatches.mockResolvedValue({ matches: [], total: 0, available: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('catalogue health', () => {
  it('shows the score and every non-zero count; nothing before the migration', async () => {
    await show()
    expect(document.body.querySelector('[aria-label="Score 64 out of 100, Fair"]')).not.toBe(null)
    expect(text()).toContain('1No price')
    expect(text()).toContain('1Possible duplicates (pair)')
    expect(text()).toContain('2No generic name')
    expect(text()).not.toContain('No barcode')
    expect(text()).not.toContain('Hidden on CareFind')

    act(() => root.unmount()); root = createRoot(host)
    repo.getHealth.mockResolvedValue({ available: false, score: null, total: 0, counts: {} })
    await show()
    expect(text()).not.toContain('Catalogue health')
  })

  it('a count filters the list and pressing it again clears the filter', async () => {
    await show()
    await click(buttonStarting('1No price'))
    expect(repo.getPage).toHaveBeenLastCalledWith('main', expect.objectContaining({ health: 'no_price', offset: 0 }))
    expect(buttonStarting('1No price').getAttribute('aria-pressed')).toBe('true')
    await click(buttonStarting('1No price'))
    expect(repo.getPage).toHaveBeenLastCalledWith('main', expect.objectContaining({ health: '' }))
  })

  it('a failed health check does not block the list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.getHealth.mockRejectedValue(new Error('Supabase error (500): down'))
    await show()
    expect(text()).toContain('Panadol Extra')
    expect(text()).not.toContain('Catalogue health')
  })
})

describe('suggested fixes', () => {
  it('opens on the categories when items sit in "Other medicines", and is hidden when nothing needs it', async () => {
    repo.suggestions.mockResolvedValue({ available: true, total: 1, suggestions: [{ item: { id: 'm1', name: 'Panadol Extra' }, value: 'analgesics', reason: 'keyword', detail: 'panadol' }] })
    await show()
    await click(button('Suggested fixes'))
    expect(repo.suggestions).toHaveBeenCalledWith('main', 'category', { offset: 0, limit: 100 })
    expect(text()).toContain('Name contains "panadol"')

    act(() => root.unmount()); root = createRoot(host)
    repo.getHealth.mockResolvedValue({ ...HEALTH, counts: { ...HEALTH.counts, other_category: 0, no_price: 0 } })
    await show()
    expect(button('Suggested fixes')).toBeUndefined()
  })
})

describe('possible duplicates', () => {
  it('keeps the item at more locations by default, merges only after confirming, and reports what moved', async () => {
    repo.merge.mockResolvedValue({ relinked: 1, merged_locations: 1, units_moved: 3, negative_left: 0 })
    await show()
    await click(buttonStarting('1Possible duplicates'))
    expect(text()).toContain('Same name, apart from spaces or punctuation')
    expect(document.body.querySelector('input[aria-label="Keep Panadol-Extra"]').checked).toBe(true)

    // Keep the other one instead.
    await act(async () => { document.body.querySelector('input[aria-label="Keep Panadol Extra"]').click() })
    await click(button('Merge…'))
    expect(repo.merge).not.toHaveBeenCalled()
    expect(text()).toContain('Keep Panadol Extra and archive Panadol-Extra?')
    repo.duplicatePairs.mockResolvedValue({ pairs: [], total: 0 })
    await click(button('Merge'))
    expect(repo.merge).toHaveBeenCalledWith('main', 'm1', 'm2')
    expect([...document.body.querySelectorAll('[role="status"]')].map((e) => e.textContent)).toContain('Merged into Panadol Extra. 3 units moved at 1 location. 1 product now sold as Panadol Extra.')
    expect(text()).toContain('No possible duplicates')
    expect(repo.getHealth).toHaveBeenCalledTimes(2)
  })

  it('dismisses a pair, and shows the database\'s refusal when a merge is not allowed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.dismissPair.mockResolvedValue(true)
    repo.merge.mockRejectedValue(new Error('Supabase error (400): A location tracks one of these items by batch. Merge them in that location\'s Inventory instead.'))
    await show()
    await click(buttonStarting('1Possible duplicates'))
    await click(button('Merge…'))
    await click(button('Merge'))
    expect(document.body.querySelector('[role="alert"]').textContent).toContain('tracks one of these items by batch')
    await click(button('Cancel'))

    await click(button('Not duplicates'))
    expect(repo.dismissPair).toHaveBeenCalledWith('main', 'm1', 'm2')
    expect(text()).toContain('will not be suggested again')
  })

  it('shows a retryable error when the pairs cannot load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.duplicatePairs.mockRejectedValueOnce(new Error('down'))
    await show()
    await click(buttonStarting('1Possible duplicates'))
    expect(text()).toContain("couldn't load the duplicates")
  })

  it('defaultKeep prefers more locations, then more stock, then a library link', () => {
    const s = (id, locations, stock, link) => ({ id, locations, stock, catalog_item_id: link })
    expect(defaultKeep({ a: s('a', 1, 9, null), b: s('b', 2, 0, null) })).toBe('b')
    expect(defaultKeep({ a: s('a', 1, 9, null), b: s('b', 1, 2, 'x') })).toBe('a')
    expect(defaultKeep({ a: s('a', 1, 2, null), b: s('b', 1, 2, 'x') })).toBe('b')
    expect(defaultKeep({ a: s('a', 0, 0, null), b: s('b', 0, 0, null) })).toBe('a')
  })
})

describe('bulk category', () => {
  it('sets a category on the selection, or the library category, and refreshes', async () => {
    repo.setCategory.mockResolvedValue(2)
    await show()
    await act(async () => { [...document.body.querySelectorAll('label')].find((l) => l.textContent.includes('Select all on this page')).querySelector('input').click() })
    await click(button('Set category'))
    await click(lastButton('Set category'))
    expect(text()).toContain('Choose a category.')
    expect(repo.setCategory).not.toHaveBeenCalled()

    const select = document.body.querySelector('#mc-bulk-category')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, 'analgesics')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(lastButton('Set category'))
    expect(repo.setCategory).toHaveBeenCalledWith('main', ['m1', 'm2'], 'analgesics')
    expect(text()).toContain('2 items set to Pain relief.')
    expect(repo.getHealth).toHaveBeenCalledTimes(2)
  })
})
