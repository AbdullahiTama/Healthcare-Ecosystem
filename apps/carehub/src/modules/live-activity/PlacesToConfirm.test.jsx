import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// Places reps added because they were not on the map, for a field manager to confirm or dismiss.
// Standalone so it can be its own Field team page.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/places.js', () => ({
  getRepAddedFacilities: vi.fn(), confirmRepAddedFacility: vi.fn(), dismissRepAddedFacility: vi.fn(),
}))
vi.mock('../staff/repositories', () => ({ staffRepository: { getAll: vi.fn() } }))

import PlacesToConfirm from './PlacesToConfirm.jsx'
import { getRepAddedFacilities, confirmRepAddedFacility, dismissRepAddedFacility } from '../../lib/places.js'
import { staffRepository } from '../staff/repositories'

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const show = async (props = {}) => { await act(async () => { root.render(<PlacesToConfirm businessId='biz-1' {...props} />) }); await flush() }
const PLACE = { id: 'p1', name: 'Mercy Clinic', category: 'Clinic', created_by: 's9', created_at: '2026-10-22T10:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  getRepAddedFacilities.mockResolvedValue([PLACE])
  confirmRepAddedFacility.mockResolvedValue(null)
  dismissRepAddedFacility.mockResolvedValue(null)
  staffRepository.getAll.mockResolvedValue([{ id: 's9', full_name: 'Musa Bello' }])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('PlacesToConfirm', () => {
  it('lists places awaiting review, with who added them', async () => {
    await show()
    expect(getRepAddedFacilities).toHaveBeenCalledWith('biz-1', 'pending_review')
    expect(host.textContent).toContain('Mercy Clinic')
    expect(host.textContent).toContain('added by Musa Bello')
  })

  it('shows a loading state first', async () => {
    let release
    getRepAddedFacilities.mockImplementation(() => new Promise((r) => { release = () => r([]) }))
    await act(async () => { root.render(<PlacesToConfirm businessId='biz-1' />) })
    expect(host.textContent).toMatch(/loading/i)
    await act(async () => { release() })
  })

  it('an empty queue says so', async () => {
    getRepAddedFacilities.mockResolvedValue([])
    await show()
    expect(host.textContent).toContain('No facilities awaiting review.')
  })

  it('a failed load shows the reason and Try again loads again', async () => {
    getRepAddedFacilities.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    await show()
    expect(host.querySelector('[role="alert"]').textContent).toContain('offline')
    await act(async () => { button('Try again').click() })
    await flush()
    expect(getRepAddedFacilities).toHaveBeenCalledTimes(2)
  })

  it('Confirm confirms it for this company, reloads and tells the parent', async () => {
    const onChanged = vi.fn()
    await show({ onChanged })
    await act(async () => { button('Confirm').click() })
    await flush()
    expect(confirmRepAddedFacility).toHaveBeenCalledWith('p1', 'biz-1')
    expect(getRepAddedFacilities).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalled()
  })

  it('Dismiss dismisses it and reloads', async () => {
    await show()
    await act(async () => { button('Dismiss').click() })
    await flush()
    expect(dismissRepAddedFacility).toHaveBeenCalledWith('p1')
    expect(getRepAddedFacilities).toHaveBeenCalledTimes(2)
  })

  it('a refused confirm says why', async () => {
    confirmRepAddedFacility.mockRejectedValue(new Error('Manager access required'))
    await show()
    await act(async () => { button('Confirm').click() })
    await flush()
    expect(host.textContent).toContain('Manager access required')
  })

  it('names already known to the page are used without asking again', async () => {
    await show({ people: [{ id: 's9', full_name: 'Musa Bello' }] })
    expect(staffRepository.getAll).not.toHaveBeenCalled()
    expect(host.textContent).toContain('added by Musa Bello')
  })
})
