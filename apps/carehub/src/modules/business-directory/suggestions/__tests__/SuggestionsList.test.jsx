import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import SuggestionsList from '../SuggestionsList.jsx'

// "Your suggestions" under My customers: what happened to each business the rep suggested.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host, repo
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function show() {
  await act(async () => { root.render(<SuggestionsList email='rep1@a.test' repo={repo} />) })
  await flush(); await flush()
}

beforeEach(() => {
  repo = { listMine: vi.fn(async () => [
    { id: '1', name: 'Kemi Stores', business_type: 'retail', status: 'pending', created_at: '2026-10-24T10:00:00Z' },
    { id: '2', name: 'Mercy Clinic', business_type: 'clinic', status: 'accepted', created_at: '2026-10-20T10:00:00Z' },
    { id: '3', name: 'Ghost Shop', business_type: 'other', status: 'rejected', review_note: 'Closed down', created_at: '2026-10-19T10:00:00Z' },
  ]) }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('SuggestionsList', () => {
  it('lists the person\'s suggestions with what happened to each', async () => {
    await show()
    expect(repo.listMine).toHaveBeenCalledWith('rep1@a.test')
    const text = host.textContent
    expect(text).toContain('Your suggestions')
    expect(text).toContain('Kemi Stores')
    expect(text).toContain('Waiting for review')
    expect(text).toContain('Added to the directory')
    expect(text).toContain('Not added: Closed down')
  })

  it('renders nothing when there are none, when the feature is not available yet, or on failure', async () => {
    repo.listMine.mockResolvedValue([])
    await show()
    expect(host.textContent).toBe('')
    repo.listMine.mockRejectedValue(Object.assign(new Error('x'), { code: 'NOT_AVAILABLE' }))
    await show()
    expect(host.textContent).toBe('')
  })
})
