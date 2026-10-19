import { describe, it, expect, vi, beforeEach } from 'vitest'

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
