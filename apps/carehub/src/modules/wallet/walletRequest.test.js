import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn(async () => ({ error: null })) }))
vi.mock('../../lib/authClient', () => ({
  authClient: { auth: { getSession: h.getSession, refreshSession: h.refreshSession, signOut: h.signOut } },
}))

import { postWithSession, payoutClientOptions } from './walletRequest'
import { createPayoutManager } from '@care-ecosystem/shared-payout-ui'

let calls
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  calls = []
  h.getSession.mockReset()
  h.refreshSession.mockReset()
  h.signOut.mockClear()
  h.getSession.mockResolvedValue({ data: { session: { access_token: 'old' } }, error: null })
  h.refreshSession.mockImplementation(async () => {
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'new' } }, error: null })
    return { data: { session: { access_token: 'new' } }, error: null }
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// The server accepts only the renewed token; `answer` is what it says to it.
function serverAcceptingNew(answer = reply(200, { ok: true })) {
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: init.body })
    return init.headers.Authorization === 'Bearer new' ? answer : reply(401, { error: 'not_logged_in' })
  })
}

describe('postWithSession', () => {
  it('completes a withdrawal on a till whose token the server has expired: one renewal, one retry, same body', async () => {
    serverAcceptingNew(reply(200, { success: true }))
    const r = await postWithSession('/api/initiate-business-withdrawal', { amount: 500000, pin: '1234' })
    expect(r).toEqual({ ok: true, status: 200, data: { success: true } })
    expect(calls.map((c) => c.auth)).toEqual(['Bearer old', 'Bearer new'])
    expect(calls[1].body).toBe(calls[0].body)
    expect(h.refreshSession).toHaveBeenCalledTimes(1)
  })

  // The safety property for money and PIN calls: only 401 means "token
  // refused". A wrong PIN is 403 and must never be submitted a second time.
  it('never retries a wrong PIN', async () => {
    globalThis.fetch = vi.fn(async () => reply(403, { error: 'Incorrect withdrawal PIN.', code: 'pin_incorrect' }))
    const r = await postWithSession('/api/initiate-business-withdrawal', { amount: 500000, pin: '0000' })
    expect(r.ok).toBe(false)
    expect(r.data.error).toBe('Incorrect withdrawal PIN.')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(h.refreshSession).not.toHaveBeenCalled()
  })

  it('reports an ended session with a readable message and without calling the server', async () => {
    h.getSession.mockResolvedValue({ data: { session: null }, error: null })
    globalThis.fetch = vi.fn()
    const r = await postWithSession('/api/withdrawal-pin/otp', {})
    expect(r).toMatchObject({ ok: false, status: 401, sessionExpired: true })
    expect(r.data.error).toMatch(/sign in again/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('reports no connection as a network error, with a readable message', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const r = await postWithSession('/api/verify-wallet-topup', { reference: 'r' })
    expect(r).toMatchObject({ ok: false, networkError: true })
    expect(r.data.error).toMatch(/Network error/)
  })
})

describe('payoutClientOptions', () => {
  it('makes the shared payout client renew a refused token instead of failing', async () => {
    serverAcceptingNew(reply(200, { accounts: [{ id: 'a1' }], required: false }))
    const manager = createPayoutManager(payoutClientOptions)
    await manager.load()
    expect(manager.getState().loadError).toBe('')
    expect(manager.getState().accounts).toEqual([{ id: 'a1' }])
    expect(calls[0].url).toBe('/api/payout-accounts/list')
    expect(calls.map((c) => c.auth)).toEqual(['Bearer old', 'Bearer new'])
  })

  it('shows the session message when nobody is signed in', async () => {
    h.getSession.mockResolvedValue({ data: { session: null }, error: null })
    globalThis.fetch = vi.fn()
    const manager = createPayoutManager(payoutClientOptions)
    await manager.sendCode()
    expect(manager.getState().error).toMatch(/sign in again/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
