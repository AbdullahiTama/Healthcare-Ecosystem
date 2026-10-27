import { describe, it, expect, vi, beforeEach } from 'vitest'
import { keepReachableLocation, switchLocation, registerSwitchBlocker, switchBlockers } from '../locationSwitch.js'

// Moving between a business's locations: which location a reload keeps, how a switch is applied, and what may hold
// a switch back (a POS cart that would be lost).

const ROOT = { id: 'root', name: 'Allen Pharmacy', status: 'active', parent_business_id: null }
const YABA = { id: 'yaba', name: 'Allen · Yaba', status: 'active', parent_business_id: 'root' }
const SUB = { id: 'sub', name: 'Allen · Yaba · Kiosk', status: 'active', parent_business_id: 'yaba' }
const OTHER = { id: 'other', name: 'Someone Else', status: 'active', parent_business_id: null }
const rows = { root: ROOT, yaba: YABA, sub: SUB, other: OTHER }
const fetchById = vi.fn(async (id) => rows[id] || null)

describe('keepReachableLocation (a reload keeps the location the owner chose)', () => {
  beforeEach(() => fetchById.mockClear())

  it('no cached location, or the main business itself: the main business', async () => {
    expect(await keepReachableLocation(ROOT, null, fetchById)).toBe(ROOT)
    expect(await keepReachableLocation(ROOT, { id: 'root', name: 'old cached copy' }, fetchById)).toBe(ROOT)
    expect(fetchById).not.toHaveBeenCalled()
  })

  it('a branch of the owner: that branch, with fresh details from the database', async () => {
    expect(await keepReachableLocation(ROOT, { id: 'yaba', name: 'stale name' }, fetchById)).toBe(YABA)
  })

  it('a branch of a branch is reachable too', async () => {
    expect(await keepReachableLocation(ROOT, { id: 'sub' }, fetchById)).toBe(SUB)
  })

  it('another business (a shared device) falls back to the main business', async () => {
    expect(await keepReachableLocation(ROOT, { id: 'other' }, fetchById)).toBe(ROOT)
  })

  it('a deleted, inactive or missing branch falls back to the main business', async () => {
    rows.closed = { ...YABA, id: 'closed', status: 'suspended' }
    rows.gone = { ...YABA, id: 'gone', deleted_at: '2026-10-01T00:00:00Z' }
    expect(await keepReachableLocation(ROOT, { id: 'closed' }, fetchById)).toBe(ROOT)
    expect(await keepReachableLocation(ROOT, { id: 'gone' }, fetchById)).toBe(ROOT)
    expect(await keepReachableLocation(ROOT, { id: 'missing' }, fetchById)).toBe(ROOT)
  })

  it('a parent cycle in bad data ends at the depth limit and falls back', async () => {
    rows.c1 = { id: 'c1', status: 'active', parent_business_id: 'c2' }
    rows.c2 = { id: 'c2', status: 'active', parent_business_id: 'c1' }
    expect(await keepReachableLocation(ROOT, { id: 'c1' }, fetchById)).toBe(ROOT)
  })

  it('a lookup failure falls back to the main business', async () => {
    expect(await keepReachableLocation(ROOT, { id: 'yaba' }, async () => { throw new Error('offline') })).toBe(ROOT)
  })
})

describe('switchLocation', () => {
  beforeEach(() => localStorage.clear())

  it('makes the location current for the owner and remembers it', () => {
    const setAuth = vi.fn()
    const auth = { brand: ROOT, staff: null, role: 'Owner', loginTime: 1 }
    expect(switchLocation({ auth, setAuth }, YABA)).toBe(true)
    expect(setAuth).toHaveBeenCalledWith({ brand: YABA, staff: null, role: 'Owner', loginTime: 1 })
    expect(JSON.parse(localStorage.getItem('carehub_auth')).brand.id).toBe('yaba')
  })

  it('the location already current: nothing happens', () => {
    const setAuth = vi.fn()
    expect(switchLocation({ auth: { brand: YABA, role: 'Owner' }, setAuth }, YABA)).toBe(false)
    expect(setAuth).not.toHaveBeenCalled()
  })
})

describe('switch blockers', () => {
  it('a registered blocker reports its message until it unregisters', () => {
    expect(switchBlockers()).toEqual([])
    const off = registerSwitchBlocker(() => 'Your POS cart has 3 items. Switching location clears it.')
    const quiet = registerSwitchBlocker(() => null)
    expect(switchBlockers()).toEqual(['Your POS cart has 3 items. Switching location clears it.'])
    off(); quiet()
    expect(switchBlockers()).toEqual([])
  })

  it('a blocker that throws does not stop a switch from being offered', () => {
    const off = registerSwitchBlocker(() => { throw new Error('boom') })
    expect(switchBlockers()).toEqual([])
    off()
  })
})
