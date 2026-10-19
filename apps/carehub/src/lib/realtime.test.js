import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// watchTable must (1) hand the user's JWT to the realtime socket before
// subscribing, (2) report 'live' only once the server confirms SUBSCRIBED, and
// (3) report 'disconnected' when there is no session or the channel errors.

const h = vi.hoisted(() => ({
  statusCb: null,
  channel: null,
  setAuth: vi.fn(),
  removeChannel: vi.fn(),
  getSession: vi.fn(),
  unsubAuth: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    realtime: { setAuth: h.setAuth },
    channel: () => {
      h.channel = {
        on: vi.fn(() => h.channel),
        subscribe: vi.fn((cb) => { h.statusCb = cb; return h.channel }),
      }
      return h.channel
    },
    removeChannel: h.removeChannel,
  }),
}))
vi.mock('../config/supabase.js', () => ({ SB_URL: 'http://x', SB_KEY: 'k' }))
vi.mock('./authClient.js', () => ({
  authClient: {
    auth: {
      getSession: h.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: h.unsubAuth } } }),
    },
  },
}))

import { watchTable } from './realtime.js'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('watchTable', () => {
  beforeEach(() => { vi.clearAllMocks(); h.statusCb = null; h.channel = null })

  it('authorises the socket before subscribing and goes live only on SUBSCRIBED', async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1' } } })
    const seen = []
    watchTable('field_activities', 'b1', () => {}, (s) => seen.push(s))
    expect(seen).toEqual(['connecting'])
    await flush()
    expect(h.setAuth).toHaveBeenCalledWith('jwt-1')
    expect(seen).toEqual(['connecting'])
    h.statusCb('SUBSCRIBED')
    expect(seen).toEqual(['connecting', 'live'])
    h.statusCb('CHANNEL_ERROR')
    expect(seen.at(-1)).toBe('disconnected')
  })

  it('reports disconnected, and opens no channel, when there is no session', async () => {
    h.getSession.mockResolvedValue({ data: { session: null } })
    const seen = []
    watchTable('field_activities', 'b1', () => {}, (s) => seen.push(s))
    await flush()
    expect(seen).toEqual(['connecting', 'disconnected'])
    expect(h.channel).toBeNull()
  })

  it('does not open a channel if unsubscribed before the session resolves', async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    const stop = watchTable('field_activities', 'b1', () => {}, () => {})
    stop()
    await flush()
    expect(h.channel).toBeNull()
  })

  it('removes the channel and auth listener on cleanup', async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    const stop = watchTable('field_activities', 'b1', () => {}, () => {})
    await flush()
    stop()
    expect(h.removeChannel).toHaveBeenCalledTimes(1)
    expect(h.unsubAuth).toHaveBeenCalledTimes(1)
  })

  it('is a no-op without a business id', () => {
    const seen = []
    const stop = watchTable('field_activities', null, () => {}, (s) => seen.push(s))
    expect(seen).toEqual(['disconnected'])
    expect(() => stop()).not.toThrow()
  })
})

describe('subscribeChanges: reconnection', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); h.statusCb = null; h.channel = null })
  afterEach(() => { vi.useRealTimers() })

  it('retries with exponential backoff after a drop and reports live again', async () => {
    const { subscribeChanges } = await import('./realtime.js')
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    const seen = []
    const stop = subscribeChanges({ table: 'field_activities', filter: 'business_id=eq.b1' }, () => {}, (s) => seen.push(s))
    await vi.advanceTimersByTimeAsync(0)
    h.statusCb('SUBSCRIBED')
    h.statusCb('CHANNEL_ERROR')
    expect(seen.slice(-1)).toEqual(['disconnected'])
    expect(h.removeChannel).toHaveBeenCalledTimes(1)

    const firstChannel = h.channel
    await vi.advanceTimersByTimeAsync(1999)
    expect(h.channel).toBe(firstChannel) // not yet
    await vi.advanceTimersByTimeAsync(2)
    expect(h.channel).not.toBe(firstChannel) // a fresh channel after 2 s
    h.statusCb('SUBSCRIBED')
    expect(seen.slice(-1)).toEqual(['live'])

    // A second drop starts the backoff over because the first reconnect succeeded.
    h.statusCb('TIMED_OUT')
    const secondChannel = h.channel
    await vi.advanceTimersByTimeAsync(2001)
    expect(h.channel).not.toBe(secondChannel)
    stop()
  })

  it('doubles the delay while reconnects keep failing, capped at 30 s', async () => {
    const { subscribeChanges, RECONNECT_MAX_MS } = await import('./realtime.js')
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    const stop = subscribeChanges({ table: 't' }, () => {}, () => {})
    await vi.advanceTimersByTimeAsync(0)
    const delays = []
    for (let i = 0; i < 7; i++) {
      const before = h.channel
      h.statusCb('CHANNEL_ERROR')
      let waited = 0
      while (h.channel === before && waited < 40000) { await vi.advanceTimersByTimeAsync(500); waited += 500 }
      delays.push(waited)
    }
    expect(delays[0]).toBe(2000); expect(delays[1]).toBe(4000); expect(delays[2]).toBe(8000)
    expect(Math.max(...delays)).toBeLessThanOrEqual(RECONNECT_MAX_MS)
    expect(delays[6]).toBe(30000)
    stop()
  })

  it('stops retrying once unsubscribed', async () => {
    const { subscribeChanges } = await import('./realtime.js')
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    const stop = subscribeChanges({ table: 't' }, () => {}, () => {})
    await vi.advanceTimersByTimeAsync(0)
    h.statusCb('CHANNEL_ERROR')
    stop()
    const ch = h.channel
    await vi.advanceTimersByTimeAsync(60000)
    expect(h.channel).toBe(ch)
  })

  it('keeps retrying when there is no session yet, instead of staying silent', async () => {
    const { subscribeChanges } = await import('./realtime.js')
    h.getSession.mockResolvedValue({ data: { session: null } })
    const seen = []
    const stop = subscribeChanges({ table: 't' }, () => {}, (s) => seen.push(s))
    await vi.advanceTimersByTimeAsync(2100)
    expect(seen.filter((s) => s === 'disconnected').length).toBeGreaterThanOrEqual(2)
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    await vi.advanceTimersByTimeAsync(5000)
    h.statusCb('SUBSCRIBED')
    expect(seen.slice(-1)).toEqual(['live'])
    stop()
  })

  it('delivers rows from the channel to the handler', async () => {
    const { subscribeChanges } = await import('./realtime.js')
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    const rows = []
    const stop = subscribeChanges({ table: 't', event: '*' }, (p) => rows.push(p), () => {})
    await vi.advanceTimersByTimeAsync(0)
    const handler = h.channel.on.mock.calls[0][2]
    handler({ eventType: 'INSERT', new: { id: 1 } })
    expect(rows).toEqual([{ eventType: 'INSERT', new: { id: 1 } }])
    stop()
  })
})
