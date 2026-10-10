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

import { createPayoutManager } from './stores.js'

describe('createPayoutManager', () => {
  const make = () => createPayoutManager({ getToken: async () => 'tok' })
  // route table: path -> {status, body}; records calls
  function routes(table) {
    const log = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      log.push([url, init.body ? JSON.parse(init.body) : null, init.headers.Authorization])
      const r = typeof table[url] === 'function' ? table[url](init.body ? JSON.parse(init.body) : {}) : table[url]
      return { ok: r.status < 400, status: r.status, json: async () => r.body }
    }))
    return log
  }
  const KYC = { status: 200, body: { verified: true, tier: 1, legalName: 'ADA OBI', bvnLast4: '1234', ninLast4: '5678' } }
  const LIST = { status: 200, body: { accounts: [{ id: 'a1', bankName: 'GTBank', accountLast4: '6789', accountName: 'ADA OBI', isDefault: true }], required: true } }

  beforeEach(() => vi.unstubAllGlobals())

  it('loads identity and accounts together, with the bearer token', async () => {
    const log = routes({ '/api/kyc/status': KYC, '/api/payout-accounts/list': LIST })
    const m = make()
    expect(m.getState().loading).toBe(true)
    await m.load()
    expect(m.getState()).toMatchObject({ loading: false, loadError: '', required: true })
    expect(m.getState().kyc.verified).toBe(true)
    expect(m.getState().accounts).toHaveLength(1)
    expect(log.every(([, , auth]) => auth === 'Bearer tok')).toBe(true)
  })

  it('shows a load error when either call fails', async () => {
    routes({ '/api/kyc/status': KYC, '/api/payout-accounts/list': { status: 500, body: {} } })
    const m = make()
    await m.load()
    expect(m.getState().loadError).toMatch(/Could not load/)
  })

  it('verifyIdentity validates locally, sends once, and stores the result', async () => {
    const log = routes({ '/api/kyc/verify': { status: 200, body: { verified: true, tier: 1, legalName: 'ADA OBI' } } })
    const m = make()
    expect(await m.verifyIdentity({ bvn: '123', nin: '456' })).toBe(false)
    expect(m.getState().error).toMatch(/11-digit/)
    expect(log).toHaveLength(0)
    expect(await m.verifyIdentity({ bvn: '22222222222', nin: '11111111111' })).toBe(true)
    expect(m.getState().kyc.verified).toBe(true)
    expect(m.getState().busy).toBe('')
  })

  it('surfaces a server refusal with its code', async () => {
    routes({ '/api/kyc/verify': { status: 422, body: { error: 'The BVN and NIN do not belong to the same person.', code: 'identity_mismatch' } } })
    const m = make()
    expect(await m.verifyIdentity({ bvn: '22222222222', nin: '11111111111' })).toBe(false)
    expect(m.getState()).toMatchObject({ error: 'The BVN and NIN do not belong to the same person.', code: 'identity_mismatch', busy: '' })
  })

  it('sendCode then addAccount: validates the code locally, then refreshes the list', async () => {
    const log = routes({
      '/api/payout-accounts/otp': { status: 200, body: { ok: true, sentTo: 'a**@x.com' } },
      '/api/payout-accounts/add': { status: 201, body: { ok: true } },
      '/api/kyc/status': KYC, '/api/payout-accounts/list': LIST,
    })
    const m = make()
    await m.sendCode()
    expect(m.getState()).toMatchObject({ codeSent: true, sentTo: 'a**@x.com' })
    expect(await m.addAccount({ bankCode: '058', accountNumber: '0123456789', otp: '12' })).toBe(false)
    expect(m.getState().code).toBe('otp_invalid')
    expect(await m.addAccount({ bankCode: '058', accountNumber: '0123456789', otp: '123456' })).toBe(true)
    expect(log.find(([u]) => u === '/api/payout-accounts/add')[1]).toEqual({ bankCode: '058', accountNumber: '0123456789', otp: '123456' })
    expect(m.getState()).toMatchObject({ codeSent: false, busy: '' })
    expect(m.getState().accounts).toHaveLength(1)
  })

  it('a name mismatch is shown with the bank\'s name', async () => {
    routes({ '/api/payout-accounts/add': { status: 422, body: { error: 'The account name must match the name on your verified BVN.', code: 'name_mismatch', accountName: 'TUNDE BELLO' } } })
    const m = make()
    expect(await m.addAccount({ bankCode: '058', accountNumber: '0123456789', otp: '123456' })).toBe(false)
    expect(m.getState().code).toBe('name_mismatch')
  })

  it('remove needs a PIN; setDefault reloads', async () => {
    const log = routes({ '/api/payout-accounts/remove': { status: 200, body: { ok: true } }, '/api/payout-accounts/default': { status: 200, body: { ok: true } }, '/api/kyc/status': KYC, '/api/payout-accounts/list': LIST })
    const m = make()
    expect(await m.remove({ id: 'a1', pin: '' })).toBe(false)
    expect(log).toHaveLength(0)
    expect(await m.remove({ id: 'a1', pin: '1234' })).toBe(true)
    expect(log.find(([u]) => u === '/api/payout-accounts/remove')[1]).toEqual({ id: 'a1', pin: '1234' })
    expect(await m.setDefault('a1')).toBe(true)
  })

  it('loads the limits, and verifySelfie validates locally then reloads', async () => {
    const log = routes({
      '/api/kyc/status': KYC,
      '/api/payout-accounts/list': { status: 200, body: { accounts: [], required: false, limits: { tier: 1, dailyCapKobo: 5000000, nextTierCapKobo: 50000000 } } },
      '/api/kyc/selfie': { status: 200, body: { verified: true, tier: 2 } },
    })
    const m = make()
    await m.load()
    expect(m.getState().limits).toMatchObject({ tier: 1, nextTierCapKobo: 50000000 })
    expect(await m.verifySelfie({ bvn: '123', selfieImage: 'x' })).toBe(false)
    expect(await m.verifySelfie({ bvn: '22222222222', selfieImage: '' })).toBe(false)
    expect(log.some(([u]) => u === '/api/kyc/selfie')).toBe(false)
    expect(await m.verifySelfie({ bvn: '22222222222', selfieImage: 'IMG' })).toBe(true)
    expect(log.find(([u]) => u === '/api/kyc/selfie')[1]).toEqual({ bvn: '22222222222', selfieImage: 'IMG' })
  })

  it('surfaces a selfie mismatch', async () => {
    routes({ '/api/kyc/selfie': { status: 422, body: { error: 'The selfie did not match.', code: 'selfie_mismatch' } } })
    const m = make()
    expect(await m.verifySelfie({ bvn: '22222222222', selfieImage: 'IMG' })).toBe(false)
    expect(m.getState().code).toBe('selfie_mismatch')
  })

  it('reports a network failure and clears busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const m = make()
    expect(await m.sendCode()).toBe(false)
    expect(m.getState()).toMatchObject({ busy: '', code: 'network' })
  })
})
