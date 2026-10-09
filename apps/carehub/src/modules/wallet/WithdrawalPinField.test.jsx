import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/authClient', () => ({
  authClient: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-test' } } })) } },
}))

import WithdrawalPinField from './WithdrawalPinField.jsx'
import { startBusinessWithdrawal, withdrawalErrorMessage } from './withdrawalApi.js'
import { authClient } from '../../lib/authClient'

let root, host, fetchMock

// A tiny parent that owns the PIN the way the Wallet and Appointments screens do.
function Harness({ needsPin = false, onPin }) {
  const [pin, setPin] = useState('')
  return <WithdrawalPinField pin={pin} onPinChange={(v) => { setPin(v); onPin?.(v) }} needsPin={needsPin} />
}

const type = async (id, value) => {
  const el = host.querySelector(`#${id}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const click = async (text) => {
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))
  await act(async () => { btn.click() })
}
const mount = async (props) => { await act(async () => { root.render(<Harness {...props} />) }) }
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('WithdrawalPinField', () => {
  it('renders an accessible numeric password field and keeps only digits (max 6)', async () => {
    const seen = []
    await mount({ onPin: (v) => seen.push(v) })
    const input = host.querySelector('#withdrawal-pin')
    expect(input.type).toBe('password')
    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(host.querySelector('label[for="withdrawal-pin"]')).toBeTruthy()
    await type('withdrawal-pin', '12ab34567')
    expect(seen.at(-1)).toBe('123456')
  })

  it('creating a first PIN: asks the server whether one exists, validates, then saves and fills the field', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('/status') ? reply(200, { hasPin: false }) : url.endsWith('/otp') ? reply(200, { ok: true, sentTo: 'o**@x.com' }) : reply(200, { ok: true })))
    const seen = []
    await mount({ onPin: (v) => seen.push(v) })
    await click('Set or change PIN')
    expect(host.querySelector('#current-pin')).toBeNull()           // nothing to confirm on a first PIN
    expect(host.querySelector('#new-pin')).toBeNull()               // the form only appears once a code was emailed
    await click('Email me a code')
    expect(host.textContent).toContain('o**@x.com')
    await type('pin-code', '123456')
    await type('new-pin', '4321'); await type('confirm-new-pin', '4321')
    await click('Save PIN')
    const set = fetchMock.mock.calls.find(([u]) => u.endsWith('/set'))
    expect(JSON.parse(set[1].body)).toEqual({ pin: '4321', otp: '123456' })
    expect(set[1].headers.Authorization).toBe('Bearer tok-test')
    expect(seen.at(-1)).toBe('4321')
    expect(host.textContent).toContain('PIN saved')
    expect(host.querySelector('#new-pin')).toBeNull()               // form closed
  })

  it('refuses locally: not 4-6 digits, or the two entries differ; nothing is sent', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('/otp') ? reply(200, { ok: true }) : reply(200, { hasPin: false })))
    await mount()
    await click('Set or change PIN')
    await click('Email me a code')
    await type('new-pin', '12'); await type('confirm-new-pin', '12')
    await click('Save PIN')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/4 to 6 digits/)
    await type('new-pin', '1234'); await type('confirm-new-pin', '4321')
    await click('Save PIN')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/do not match/)
    await type('confirm-new-pin', '1234')
    await click('Save PIN')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/6-digit code/)
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith('/set'))).toBe(false)
  })

  it('changing an existing PIN requires the current one, and a server refusal is shown (error state)', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('/status') ? reply(200, { hasPin: true }) : url.endsWith('/otp') ? reply(200, { ok: true }) : reply(403, { error: 'Incorrect withdrawal PIN.' })))
    await mount()
    await click('Set or change PIN')
    await click('Email me a code')
    expect(host.querySelector('#current-pin')).toBeTruthy()
    await type('pin-code', '123456')
    await type('new-pin', '9999'); await type('confirm-new-pin', '9999')
    await click('Save PIN')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/current PIN/)
    await type('current-pin', '0000')
    await click('Save PIN')
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body)).toEqual({ pin: '9999', otp: '123456', currentPin: '0000' })
    expect(host.querySelector('[role="alert"]').textContent).toBe('Incorrect withdrawal PIN.')
    expect(host.querySelector('#new-pin')).toBeTruthy()             // stays open so the owner can retry
  })

  it('"I forgot my PIN" drops the current-PIN field and sends forgot instead', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('/status') ? reply(200, { hasPin: true }) : reply(200, { ok: true })))
    await mount()
    await click('Set or change PIN')
    await click('Email me a code')
    await act(async () => { host.querySelector('input[type="checkbox"]').click() })
    expect(host.querySelector('#current-pin')).toBeNull()
    await type('pin-code', '654321')
    await type('new-pin', '2468'); await type('confirm-new-pin', '2468')
    await click('Save PIN')
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body)).toEqual({ pin: '2468', otp: '654321', forgot: true })
  })

  it('a refused code request (cooldown) is shown and the form stays on step 1', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('/status') ? reply(200, { hasPin: false }) : reply(429, { error: 'Please wait a minute before requesting another code.' })))
    await mount()
    await click('Set or change PIN')
    await click('Email me a code')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/wait a minute/)
    expect(host.querySelector('#new-pin')).toBeNull()
  })

  it('the server saying "no PIN yet" (needsPin) opens the create step straight away', async () => {
    fetchMock.mockImplementation(async () => reply(200, { hasPin: false }))
    await mount({ needsPin: true })
    expect(host.textContent).toContain('Withdrawals need a PIN')
    expect(host.textContent).toContain('Email me a code')
  })

  it('a network failure while saving is shown, and the button is usable again', async () => {
    fetchMock.mockImplementation(async (url) => { if (url.endsWith('/status')) return reply(200, { hasPin: false }); if (url.endsWith('/otp')) return reply(200, { ok: true }); throw new Error('offline') })
    await mount()
    await click('Set or change PIN')
    await click('Email me a code')
    await type('pin-code', '123456')
    await type('new-pin', '1234'); await type('confirm-new-pin', '1234')
    await click('Save PIN')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/Network error/)
    expect([...host.querySelectorAll('button')].find((b) => b.textContent.includes('Save PIN')).disabled).toBe(false)
  })
})

describe('startBusinessWithdrawal / withdrawalErrorMessage', () => {
  it('sends only what the owner typed (plus the PIN) with the session token', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true }))
    const r = await startBusinessWithdrawal({ businessId: 'b1', amountKobo: 500000, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Clinic', pin: '1234' })
    expect(r.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/initiate-business-withdrawal')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ business_id: 'b1', amount: 500000, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Clinic', pin: '1234' })
  })

  it('reports an expired session and a network error distinctly', async () => {
    authClient.auth.getSession.mockResolvedValueOnce({ data: { session: null } })
    expect((await startBusinessWithdrawal({})).sessionExpired).toBe(true)
    fetchMock.mockRejectedValue(new Error('offline'))
    expect((await startBusinessWithdrawal({})).networkError).toBe(true)
  })

  it('turns server answers into owner-facing text', () => {
    expect(withdrawalErrorMessage({ needsPin: true })).toMatch(/Set a withdrawal PIN/)
    expect(withdrawalErrorMessage({ error: 'insufficient' })).toMatch(/Not enough/)
    expect(withdrawalErrorMessage({ error: 'daily_limit', message: 'Limit hit' })).toBe('Limit hit')
    expect(withdrawalErrorMessage({ error: 'Incorrect withdrawal PIN.' })).toBe('Incorrect withdrawal PIN.')
    expect(withdrawalErrorMessage({})).toMatch(/Could not start/)
  })
})
