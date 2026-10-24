import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import SuggestionsTab from '../SuggestionsTab.jsx'

// Platform admin > Directory > Suggestions: businesses field reps suggested, oldest first, with what is already
// listed nearby so a duplicate is caught before it is added.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PENDING = [
  { id: 's1', name: 'Kemi Stores', business_type: 'retail', address: '2 Allen Ave', latitude: 6.6, longitude: 3.35, note: 'by the junction', suggested_by_name: 'Ada Rep', created_at: '2026-10-20T10:00:00Z', businesses: { name: 'Pharma Co' } },
  { id: 's2', name: 'Mercy Clinic', business_type: 'clinic', address: null, latitude: 6.5, longitude: 3.4, note: null, suggested_by_name: 'Bola', created_at: '2026-10-22T10:00:00Z', businesses: { name: 'Wholesale Co' } },
]

let root, host, repo, suggestionRepo
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const card = (name) => [...host.querySelectorAll('li')].find((li) => li.textContent.includes(name))
const btnIn = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
async function show(props = {}) {
  const onAdd = vi.fn()
  await act(async () => { root.render(<SuggestionsTab repo={repo} suggestionRepo={suggestionRepo} scopeId='platform' onAdd={onAdd} {...props} />) })
  await flush(); await flush()
  return onAdd
}

beforeEach(() => {
  repo = { searchWithinBox: vi.fn(async (scope, at) => (at.lat === 6.6 ? [{ id: 'd1', name: 'Kemi Store (Allen)' }] : [])) }
  suggestionRepo = { listPending: vi.fn(async () => PENDING), reject: vi.fn(async () => ({})), markAccepted: vi.fn(async () => ({})) }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('SuggestionsTab', () => {
  it('lists pending suggestions oldest first with company, rep, type, address and note', async () => {
    await show()
    const text = host.textContent
    expect(text.indexOf('Kemi Stores')).toBeLessThan(text.indexOf('Mercy Clinic'))
    const k = card('Kemi Stores').textContent
    expect(k).toContain('Retail shop')
    expect(k).toContain('2 Allen Ave')
    expect(k).toContain('by the junction')
    expect(k).toContain('Ada Rep · Pharma Co')
  })

  it('shows what is already listed nearby, or says nothing is', async () => {
    await show()
    expect(repo.searchWithinBox).toHaveBeenCalledWith('platform', { lat: 6.6, lng: 3.35, radiusKm: 0.2 }, {}, { limit: 10 })
    expect(card('Kemi Stores').textContent).toContain('Already listed nearby: Kemi Store (Allen)')
    expect(card('Mercy Clinic').textContent).toContain('No listing within about 200 m')
  })

  it('Add to directory opens the business form pre-filled from the suggestion', async () => {
    const onAdd = await show()
    await act(async () => { btnIn(card('Kemi Stores'), 'Add to directory').click() })
    expect(onAdd).toHaveBeenCalledWith({
      fromSuggestion: 's1', name: 'Kemi Stores', address: '2 Allen Ave', latitude: 6.6, longitude: 3.35,
      description: 'Suggested by Ada Rep of Pharma Co. Type: Retail shop. by the junction',
    })
  })

  it('Reject with an optional reason removes it from the list', async () => {
    await show()
    await act(async () => { btnIn(card('Mercy Clinic'), 'Reject').click() })
    const reason = card('Mercy Clinic').querySelector('input[aria-label="Reason (optional)"]')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(reason, 'Duplicate'); reason.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { btnIn(card('Mercy Clinic'), 'Confirm reject').click() })
    await flush()
    expect(suggestionRepo.reject).toHaveBeenCalledWith('s2', 'Duplicate')
    expect(card('Mercy Clinic')).toBeUndefined()
  })

  it('a suggestion whose listing was created but could not be marked offers Mark as added', async () => {
    await show({ unmarked: { s1: 'dir-9' } })
    expect(card('Kemi Stores').textContent).toContain('The listing was added but this suggestion is still open.')
    await act(async () => { btnIn(card('Kemi Stores'), 'Mark as added').click() })
    await flush()
    expect(suggestionRepo.markAccepted).toHaveBeenCalledWith('s1', 'dir-9')
    expect(card('Kemi Stores')).toBeUndefined()
  })

  it('a failed review says so and keeps the suggestion', async () => {
    suggestionRepo.reject.mockRejectedValue(new Error('This suggestion has already been handled, or you cannot review it.'))
    await show()
    await act(async () => { btnIn(card('Mercy Clinic'), 'Reject').click() })
    await act(async () => { btnIn(card('Mercy Clinic'), 'Confirm reject').click() })
    await flush()
    expect(card('Mercy Clinic').textContent).toContain('already been handled')
  })

  it('loading, error with retry, and empty', async () => {
    suggestionRepo.listPending.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => { root.render(<SuggestionsTab repo={repo} suggestionRepo={suggestionRepo} scopeId='platform' onAdd={vi.fn()} />) })
    expect(host.textContent).toMatch(/loading suggestions/i)
    await act(async () => { root.render(<></>) })
    suggestionRepo.listPending.mockRejectedValueOnce(new Error('timeout'))
    await show()
    expect(host.textContent).toMatch(/could not load suggestions: timeout/i)
    suggestionRepo.listPending.mockResolvedValueOnce([])
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click() })
    await flush()
    expect(host.textContent).toContain('No suggestions waiting.')
  })
})
