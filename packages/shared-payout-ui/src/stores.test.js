import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAccountResolver, createPinSetup } from './stores.js'

function mockFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const { status, body } = await handler(url, init)
    return { ok: status < 400, status, json: async () => body }
  }))
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createAccountResolver', () => {
  beforeEach(() => vi.unstubAllGlobals())
  const make = () => createAccountResolver({ getToken: async () => 'tok' })

  it('stays idle until a bank and a full 10-digit number are present, then resolves with the bearer token', async () => {
    mockFetch(async () => ({ status: 200, body: { accountName: 'ADA OBI' } }))
    const r = make()
    await r.setBank('999991')
    await r.setAccountNumber('80123')
    expect(r.getState().status).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()
    await r.setAccountNumber('8012345678')
    expect(r.getState()).toMatchObject({ status: 'ok', accountName: 'ADA OBI' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/resolve-account')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ bankCode: '999991', accountNumber: '8012345678' })
  })

  it('strips non-digits and caps at 10', async () => {
    const r = make()
    await r.setAccountNumber('80-12 34567890123')
    expect(r.getState().accountNumber).toBe('8012345678')
  })

  it('surfaces the server error, and clears the name when the input changes', async () => {
    mockFetch(async () => ({ status: 404, body: { error: 'Could not verify this account.' } }))
    const r = make()
    await r.setBank('1')
    await r.setAccountNumber('0123456789')
    expect(r.getState()).toMatchObject({ status: 'error', error: 'Could not verify this account.', accountName: '' })
    await r.setAccountNumber('012345678')
    expect(r.getState()).toMatchObject({ status: 'idle', error: '' })
  })

  it('flags a bank that cannot be looked up automatically', async () => {
    mockFetch(async () => ({ status: 400, body: { error: 'This bank does not support automatic account verification.', unsupportedBank: true } }))
    const r = make()
    await r.setBank('1')
    await r.setAccountNumber('0123456789')
    expect(r.getState().status).toBe('unsupported')
  })

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const r = make()
    await r.setBank('1')
    await r.setAccountNumber('0123456789')
    expect(r.getState().status).toBe('error')
  })

  it('discards a stale response when the user has moved on', async () => {
    let release
    const gate = new Promise((res) => { release = res })
    mockFetch(async (_u, init) => {
      const { accountNumber } = JSON.parse(init.body)
      if (accountNumber === '1111111111') await gate
      return { status: 200, body: { accountName: `NAME ${accountNumber}` } }
    })
    const r = make()
    await r.setBank('1')
    const slow = r.setAccountNumber('1111111111')
    await tick()
    await r.setAccountNumber('2222222222')
    expect(r.getState().accountName).toBe('NAME 2222222222')
    release()
    await slow
    expect(r.getState().accountName).toBe('NAME 2222222222')
  })

  it('notifies subscribers and gives a new state object per change', async () => {
    const r = make()
    const seen = []
    const off = r.subscribe(() => seen.push(r.getState()))
    await r.setBank('1')
    off()
    await r.setBank('2')
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).not.toBe(r.getState())
  })
})

describe('createPinSetup', () => {
  beforeEach(() => vi.unstubAllGlobals())
  const make = () => createPinSetup({ getToken: async () => 'tok' })

  it('sends a code and records the masked address', async () => {
    mockFetch(async () => ({ status: 200, body: { ok: true, sentTo: 'a**@x.com' } }))
    const p = make()
    expect(await p.sendCode()).toBe(true)
    expect(p.getState()).toMatchObject({ codeSent: true, sentTo: 'a**@x.com', sending: false })
    expect(fetch.mock.calls[0][0]).toBe('/api/withdrawal-pin/otp')
  })

  it('shows the cooldown message from the server', async () => {
    mockFetch(async () => ({ status: 429, body: { error: 'Please wait a minute before requesting another code.' } }))
    const p = make()
    expect(await p.sendCode()).toBe(false)
    expect(p.getState().error).toContain('wait a minute')
    expect(p.getState().codeSent).toBe(false)
  })

  it('validates locally before calling the server', async () => {
    mockFetch(async () => ({ status: 200, body: { ok: true } }))
    const p = make()
    expect(await p.submit({ pin: '12', confirmPin: '12', otp: '123456' })).toBe(false)
    expect(await p.submit({ pin: '1234', confirmPin: '9999', otp: '123456' })).toBe(false)
    expect(p.getState().error).toContain('do not match')
    expect(await p.submit({ pin: '1234', confirmPin: '1234', otp: '12' })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits pin + code (+ current pin / forgot) and marks done', async () => {
    mockFetch(async () => ({ status: 200, body: { ok: true } }))
    const p = make()
    expect(await p.submit({ pin: '1234', confirmPin: '1234', otp: '123456', currentPin: '9999', forgot: false })).toBe(true)
    expect(p.getState().done).toBe(true)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ pin: '1234', otp: '123456', currentPin: '9999', forgot: false })
  })

  it('shows server rejection', async () => {
    mockFetch(async () => ({ status: 400, body: { error: 'Incorrect code. Check the email and try again.' } }))
    const p = make()
    expect(await p.submit({ pin: '1234', confirmPin: '1234', otp: '123456' })).toBe(false)
    expect(p.getState()).toMatchObject({ done: false, submitting: false, error: 'Incorrect code. Check the email and try again.' })
  })
})
