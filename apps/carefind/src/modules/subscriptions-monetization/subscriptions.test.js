import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NAIRA_PER_COIN, MAX_PRICE_COINS, coinsToNaira, checkAccess, subscribe, cancelAutoRenew, loadActiveCreatorIds } from './subscriptions.js'

const mockSupabase = vi.hoisted(() => ({
  data: null,
  error: null,
  from: vi.fn(() => mockSupabase.q),
  q: null,
}))

vi.mock('../../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => mockSupabase.q),
    rpc: vi.fn(() => Promise.resolve({ data: mockSupabase.data, error: mockSupabase.error })),
  },
}))

beforeEach(() => {
  mockSupabase.data = null
  mockSupabase.error = null
  const q = {}
  q.select = vi.fn(() => q)
  q.eq = vi.fn(() => q)
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: mockSupabase.data, error: mockSupabase.error }))
  q.update = vi.fn(() => q)
  q.then = (resolve) => resolve({ data: mockSupabase.data, error: mockSupabase.error })
  mockSupabase.q = q
})

describe('coinsToNaira', () => {
  it('converts 1 CareCoin to ₦200', () => {
    expect(NAIRA_PER_COIN).toBe(200)
    expect(coinsToNaira(1)).toBe(200)
    expect(coinsToNaira(12)).toBe(2400)
  })

  it('treats missing or invalid values as zero coins', () => {
    expect(coinsToNaira(null)).toBe(0)
    expect(coinsToNaira(undefined)).toBe(0)
    expect(coinsToNaira('abc')).toBe(0)
  })

  it('caps creator pricing at 12 coins', () => {
    expect(MAX_PRICE_COINS).toBe(12)
    expect(coinsToNaira(MAX_PRICE_COINS)).toBe(2400)
  })
})

describe('subscribe', () => {
  it('rejects missing users without touching supabase', async () => {
    const result = await subscribe(null, 'c1', 5)
    expect(result).toEqual({ error: 'Missing user' })
    expect(mockSupabase.q.select).not.toHaveBeenCalled()
  })

  it('rejects a non-positive price', async () => {
    expect(await subscribe('u1', 'c1', 0)).toEqual({ error: 'Invalid price' })
    expect(await subscribe('u1', 'c1', -3)).toEqual({ error: 'Invalid price' })
    expect(await subscribe('u1', 'c1', null)).toEqual({ error: 'Invalid price' })
  })

  it('reports success when the wallet RPC answers ok', async () => {
    mockSupabase.data = 'ok'
    const result = await subscribe('u1', 'c1', 5)
    expect(result).toEqual({ ok: true })
  })

  it('reports insufficient funds when the RPC says so', async () => {
    mockSupabase.data = 'insufficient'
    expect(await subscribe('u1', 'c1', 5)).toEqual({ insufficient: true })
  })

  it('surfaces an RPC error', async () => {
    mockSupabase.error = new Error('permission denied')
    const result = await subscribe('u1', 'c1', 5)
    expect(result.error).toBe('permission denied')
  })
})

describe('checkAccess', () => {
  it('denies access without a viewer or creator', async () => {
    expect(await checkAccess(null, 'c1')).toEqual({ active: false })
    expect(await checkAccess('u1', null)).toEqual({ active: false })
  })

  it('always grants access to your own content', async () => {
    expect(await checkAccess('u1', 'u1')).toEqual({ active: true })
  })

  it('denies access when no subscription exists', async () => {
    mockSupabase.data = null
    expect(await checkAccess('u1', 'c1')).toEqual({ active: false })
  })

  it('grants access while the subscription is still valid', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    mockSupabase.data = { expires_at: future, auto_renew: true, price: 5 }
    const result = await checkAccess('u1', 'c1')
    expect(result.active).toBe(true)
    expect(result.renewed).toBeUndefined()
  })

  it('lets an expired non-renewing subscription lapse', async () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    mockSupabase.data = { expires_at: past, auto_renew: false, price: 5 }
    const result = await checkAccess('u1', 'c1')
    expect(result.active).toBe(false)
  })
})

describe('cancelAutoRenew', () => {
  it('marks the subscription as no longer renewing', async () => {
    mockSupabase.error = null
    const result = await cancelAutoRenew('u1', 'c1')
    expect(result).toEqual({ ok: true })
    expect(mockSupabase.q.update).toHaveBeenCalledWith({ auto_renew: false })
  })

  it('reports an error when the update fails', async () => {
    mockSupabase.error = new Error('gone')
    const result = await cancelAutoRenew('u1', 'c1')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('gone')
  })
})

describe('loadActiveCreatorIds', () => {
  it('returns no creators without a viewer', async () => {
    expect(await loadActiveCreatorIds(null)).toEqual([])
  })

  it('returns only creators whose subscription has not expired', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    const past = new Date(Date.now() - 86400000).toISOString()
    mockSupabase.data = [
      { creator_id: 'c1', expires_at: future },
      { creator_id: 'c2', expires_at: past },
      { creator_id: 'c3', expires_at: future },
    ]
    const ids = await loadActiveCreatorIds('u1')
    expect(ids).toEqual(['c1', 'c3'])
  })
})