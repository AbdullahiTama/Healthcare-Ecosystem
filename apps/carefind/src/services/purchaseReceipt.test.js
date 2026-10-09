import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../config/supabaseClient', () => ({ supabase: { auth: { getSession } } }))

import { requestPurchaseReceipt } from './purchaseReceipt.js'

describe('requestPurchaseReceipt', () => {
  beforeEach(() => { global.fetch = vi.fn().mockResolvedValue({ ok: true }) })
  afterEach(() => { delete global.fetch })

  it('asks the server to confirm, authenticated as the buyer, and survives navigation', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } })
    await requestPurchaseReceipt({ kind: 'consultation', professionalId: 'p1' })

    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/purchase-receipt')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jwt-123')
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body)).toEqual({ kind: 'consultation', professionalId: 'p1' })
  })

  it('does nothing without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    await requestPurchaseReceipt({ kind: 'subscription', creatorId: 'c1' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('never throws — a receipt failure must not look like a failed purchase', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 't' } } })
    global.fetch.mockRejectedValue(new Error('offline'))
    await expect(requestPurchaseReceipt({ kind: 'subscription', creatorId: 'c1' })).resolves.toBeUndefined()

    getSession.mockRejectedValue(new Error('auth broke'))
    await expect(requestPurchaseReceipt({ kind: 'subscription', creatorId: 'c1' })).resolves.toBeUndefined()
  })
})
