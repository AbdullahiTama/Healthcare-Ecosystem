import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/authClient', () => ({
  authClient: { auth: { getSession: vi.fn() } },
}))

import { initiateWalletTopup, verifyWalletTopup } from './topupApi.js'
import { authClient } from '../../lib/authClient'

let fetchMock
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
  authClient.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-test' } } })
})

describe('initiateWalletTopup', () => {
  it('sends the whole-kobo amount and callback with the session token', async () => {
    fetchMock.mockResolvedValue(reply(200, { authorization_url: 'https://checkout.test/xyz', reference: 'ch_topup_1_abc' }))
    const out = await initiateWalletTopup({ amountKobo: 50_000, callbackUrl: 'http://localhost/dashboard/wallet' })
    expect(out.ok).toBe(true)
    expect(out.data.authorization_url).toBe('https://checkout.test/xyz')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/initiate-wallet-topup')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ amount: 50_000, callback_url: 'http://localhost/dashboard/wallet' })
  })

  it('reports an expired session distinctly from a network error', async () => {
    authClient.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
    expect((await initiateWalletTopup({ amountKobo: 100 })).sessionExpired).toBe(true)
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect((await initiateWalletTopup({ amountKobo: 100 })).networkError).toBe(true)
  })

  it('carries the server refusal through as data.error', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'Amount must be a whole-kobo integer between N100 and N100,000' }))
    const out = await initiateWalletTopup({ amountKobo: 50 })
    expect(out.ok).toBe(false)
    expect(out.data.error).toMatch(/whole-kobo/)
  })
})

describe('verifyWalletTopup', () => {
  it('posts only the opaque reference with the session token', async () => {
    fetchMock.mockResolvedValue(reply(200, { credited: true, newAvailable: 650_000 }))
    const out = await verifyWalletTopup('ch_topup_b1_abcdef123456')
    expect(out.ok).toBe(true)
    expect(out.data.newAvailable).toBe(650_000)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/verify-wallet-topup')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ reference: 'ch_topup_b1_abcdef123456' })
  })

  it('reports an expired session distinctly from a network error', async () => {
    authClient.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
    expect((await verifyWalletTopup('r')).sessionExpired).toBe(true)
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect((await verifyWalletTopup('r')).networkError).toBe(true)
  })

  it('surfaces an already-processed return for the caller to show quietly', async () => {
    fetchMock.mockResolvedValue(reply(200, { alreadyProcessed: true }))
    const out = await verifyWalletTopup('ch_topup_b1_replayed1234')
    expect(out.ok).toBe(true)
    expect(out.data.alreadyProcessed).toBe(true)
  })
})
