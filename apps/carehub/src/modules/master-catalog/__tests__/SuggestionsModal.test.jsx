import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// Suggested fixes (catalogue phase 6): categories and prices proposed for items missing them, reviewed and applied in
// bulk. Loading, error, empty and not-installed states; changing a suggestion before applying; push to locations; and
// dismissing.

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../repositories', () => ({ masterCatalogRepository: {}, PAGE_SIZE: 50 }))
import SuggestionsModal from '../SuggestionsModal.jsx'

const CATS = [{ code: 'general_retail', label: 'General & minimart' }, { code: 'respiratory', label: 'Asthma & inhalers' },
  { code: 'vitamins', label: 'Vitamins' }, { code: 'medicines_other', label: 'Other medicines' }]
const CAT_LIST = [
  { item: { id: 'm1', name: 'Shopping Bag' }, value: 'general_retail', reason: 'text', detail: 'SUPERMARKET' },
  { item: { id: 'm2', name: 'Ventolin Inhaler' }, value: 'respiratory', reason: 'keyword', detail: 'inhaler' },
]
const PRICE_LIST = [
  { item: { id: 'p1', name: 'Panadol Extra', hidden: 1 }, value: 400, reason: 'locations', detail: '1' },
  { item: { id: 'p2', name: 'Coartem 80/480', hidden: 0 }, value: 1600, reason: 'elsewhere', detail: '3' },
]

let root, host, repo, onChanged
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const button = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const setValue = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
async function show(kind = 'category') {
  await act(async () => { root.render(<SuggestionsModal show businessId='main' categories={CATS} initialKind={kind} repository={repo} onChanged={onChanged} onClose={() => {}} />) })
  await flush(); await flush()
}

beforeEach(() => {
  onChanged = vi.fn()
  repo = {
    suggestions: vi.fn(async (_b, kind) => ({ available: true, total: 2, suggestions: kind === 'price' ? PRICE_LIST : CAT_LIST })),
    applyFixes: vi.fn(async () => ({ categories: 2, prices: 0, location_prices: 0 })),
    dismissSuggestions: vi.fn(async () => 1),
  }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('SuggestionsModal', () => {
  it('lists category suggestions with the reason, all ticked, and applies them', async () => {
    await show()
    expect(repo.suggestions).toHaveBeenCalledWith('main', 'category', { offset: 0, limit: 100 })
    expect(text()).toContain('You filed it under "SUPERMARKET"')
    expect(text()).toContain('Name contains "inhaler"')
    expect(text()).toContain('2 of 2 ticked')
    expect([...document.body.querySelectorAll('option')].map((o) => o.value)).not.toContain('medicines_other')
    await click(button('Apply 2'))
    expect(repo.applyFixes).toHaveBeenCalledWith('main', [{ id: 'm1', category_code: 'general_retail' }, { id: 'm2', category_code: 'respiratory' }], true)
    expect(document.body.querySelector('[role="status"]').textContent).toBe('2 items given a category.')
    expect(onChanged).toHaveBeenCalled()
    expect(repo.suggestions).toHaveBeenCalledTimes(2)
  })

  it('a suggestion can be changed or unticked before applying', async () => {
    await show()
    await setValue(document.body.querySelector('select[aria-label="Category for Ventolin Inhaler"]'), 'vitamins')
    await act(async () => { document.body.querySelector('input[aria-label="Fix Shopping Bag"]').click() })
    await click(button('Apply 1'))
    expect(repo.applyFixes).toHaveBeenCalledWith('main', [{ id: 'm2', category_code: 'vitamins' }], true)
  })

  it('prices: shows where each came from and hidden locations, edits, and can skip the locations', async () => {
    repo.applyFixes.mockResolvedValue({ categories: 0, prices: 2, location_prices: 1 })
    await show('price')
    expect(text()).toContain('Price at 1 of your locations · hidden on CareFind at 1 location')
    expect(text()).toContain('Typical price at 3 other pharmacies')
    await setValue(document.body.querySelector('input[aria-label="Price for Coartem 80/480"]'), '1650')
    await act(async () => { [...document.body.querySelectorAll('label')].find((l) => l.textContent.includes('Also price the locations')).querySelector('input').click() })
    await click(button('Apply 2'))
    expect(repo.applyFixes).toHaveBeenCalledWith('main', [{ id: 'p1', default_price: 400 }, { id: 'p2', default_price: 1650 }], false)
    expect(text()).toContain('2 items given a price, and 1 location product back on CareFind.')
  })

  it('refuses a ticked price of zero without calling the database', async () => {
    await show('price')
    await setValue(document.body.querySelector('input[aria-label="Price for Panadol Extra"]'), '0')
    await click(button('Apply 2'))
    expect(repo.applyFixes).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="alert"]').textContent).toContain('above zero')
  })

  it('switches tabs and dismisses the ticked suggestions', async () => {
    await show()
    await click([...document.body.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Prices'))
    expect(repo.suggestions).toHaveBeenLastCalledWith('main', 'price', { offset: 0, limit: 100 })
    await click(button('Don’t suggest these'))
    expect(repo.dismissSuggestions).toHaveBeenCalledWith('main', ['p1', 'p2'], 'price')
    expect(text()).toContain('1 suggestion hidden. Set those prices yourself')
  })

  it('shows the database refusal, a retryable error, the empty state and the not-installed state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.applyFixes.mockRejectedValue(new Error('Supabase error (403): Only the owner or a manager of the business can change its catalogue.'))
    await show()
    await click(button('Apply 2'))
    expect(document.body.querySelector('[role="alert"]').textContent).toContain('Only the owner or a manager')

    act(() => root.unmount()); root = createRoot(host)
    repo.suggestions.mockRejectedValueOnce(new Error('down'))
    await show()
    expect(text()).toContain("couldn't load the suggestions")

    act(() => root.unmount()); root = createRoot(host)
    repo.suggestions.mockResolvedValue({ available: true, total: 0, suggestions: [] })
    await show()
    expect(text()).toContain('No category suggestions right now')

    act(() => root.unmount()); root = createRoot(host)
    repo.suggestions.mockResolvedValue({ available: false, total: 0, suggestions: [] })
    await show()
    expect(text()).toContain('once the catalogue update is installed')
  })
})
