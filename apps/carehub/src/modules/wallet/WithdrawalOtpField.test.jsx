import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/authClient', () => ({
  authClient: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-test' } } })) } },
}))

import WithdrawalOtpField from './WithdrawalOtpField.jsx'
import { authClient } from '../../lib/authClient'

let root, host, fetchMock

// A tiny parent that owns the code the way the withdrawal and set-PIN flows do.
function Harness({ onOtp, ...rest }) {
  const [otp, setOtp] = useState('')
  return <WithdrawalOtpField value={otp} onChange={(v) => { setOtp(v); onOtp?.(v) }} {...rest} />
}

const type = async (id, value) => {
  const el = host.querySelector(`#${id}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const paste = async (id, text) => {
  const el = host.querySelector(`#${id}`)
  await act(async () => {
    const ev = new Event('paste', { bubbles: true, cancelable: true })
    ev.clipboardData = { getData: () => text }
    el.dispatchEvent(ev)
  })
}
const click = async (text) => {
  const btn = [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))
  await act(async () => { btn.click() })
}
const mount = async (props) => {
  await act(async () => { root.render(<Harness {...props} />) })
  await act(async () => {}) // let the mount draft-GET settle
}
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })
const otpCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/withdrawal-pin/otp'))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  sessionStorage.clear()
  fetchMock = vi.fn(async (url) => {
    if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
    if (String(url).includes('/withdrawal-pin/otp')) return reply(200, { ok: true, expiresInSeconds: 300 })
    return reply(404, { error: 'not found' })
  })
  globalThis.fetch = fetchMock
  authClient.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-test' } } })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('WithdrawalOtpField', () => {
  it('shows a hint until the amount + destination arrive; the mount only resumes a draft (POST)', async () => {
    await mount()
    expect(host.textContent).toContain('Choose an amount and destination first.')
    expect([...host.querySelectorAll('button')].some((b) => b.textContent.includes('Email me a 6-digit code'))).toBe(false)
    expect(host.querySelector('#otp-withdrawal')).toBeNull()
    // The mount only resumes a draft (POST); the code request (POST otp) waits for the owner.
    const [draftUrl, draftInit] = fetchMock.mock.calls.find(([u]) => String(u).includes('/withdrawal-pin/draft'))
    expect(draftUrl).toBe('/api/withdrawal-pin/draft')
    expect(draftInit.method).toBe('POST')
    expect(draftInit.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(draftInit.body)).toEqual({})
    expect(otpCalls()).toHaveLength(0)
  })

  it('requests a withdrawal code with the session token, then reveals the input', async () => {
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    await click('Email me a 6-digit code')
    const [url, init] = otpCalls()[0]
    expect(url).toBe('/api/withdrawal-pin/otp')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    expect(host.querySelector('#otp-withdrawal')).toBeTruthy()
    expect(host.textContent).toContain('Code sent')
    expect([...host.querySelectorAll('button')].some((b) => b.textContent.includes('Resend available in'))).toBe(true)
  })

  it('sends a saved payout account instead of typed bank fields when one is chosen', async () => {
    await mount({ amount: 500000, payoutAccountId: 'acc-1' })
    await click('Email me a 6-digit code')
    const [, init] = otpCalls()[0]
    expect(JSON.parse(init.body)).toEqual({ purpose: 'withdrawal', amount: 500000, payoutAccountId: 'acc-1' })
  })

  it('keeps only digits (max 6) and hands them to the parent', async () => {
    const seen = []
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789', onOtp: (v) => seen.push(v) })
    await click('Email me a 6-digit code')
    await type('otp-withdrawal', '12ab34567')
    expect(seen.at(-1)).toBe('123456')
  })

  it('pasting `123 456` lands whole as `123456` (strip-then-truncate)', async () => {
    const seen = []
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789', onOtp: (v) => seen.push(v) })
    await click('Email me a 6-digit code')
    await paste('otp-withdrawal', '123 456')
    expect(seen.at(-1)).toBe('123456')
  })

  it('a live draft (409 draft_active) keeps the sent state and shows the server text', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
      if (String(url).includes('/withdrawal-pin/otp')) return reply(409, { error: 'A code is already on its way — check your email.', code: 'draft_active' })
      return reply(404, {})
    })
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    await click('Email me a 6-digit code')
    expect(host.querySelector('#otp-withdrawal')).toBeTruthy()
    expect(host.querySelector('[role="alert"]').textContent).toContain('already on its way')
  })

  it('resumes a live draft after reload: sent state, empty code, countdown + re-press terms', async () => {
    const issued = Date.now() - 61_000
    const expires = Date.now() + 9 * 60_000
    sessionStorage.setItem('ch-withdrawal-otp-meta', JSON.stringify({ draftId: 'd-1', otpIssuedAt: issued, draftExpiresAt: expires }))
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) {
        return reply(200, { draft: { id: 'd-1', app: 'carehub', amount: 500000, unit: 'kobo', destination_mask: '••••6789', draft_expires_at: new Date(expires).toISOString(), otp_issued_at: new Date(issued).toISOString() } })
      }
      return reply(404, {})
    })
    await mount()
    // A code is never refilled — the input starts empty.
    expect(host.querySelector('#otp-withdrawal').value).toBe('')
    expect(host.querySelector('[role="status"]').textContent).toMatch(/Code sent · expires in \d+:\d\d · resend in \d+ s/)
    // Cooldown already elapsed: explicit re-press with the voids-prior warning.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent.includes('Send a new code'))).toBe(true)
    expect(host.textContent).toContain('Requesting a new code voids the previous one.')
  })

  it('surfaces the server rate limit (3 codes/hour) as an alert and never reveals a code', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
      return reply(429, { error: 'Too many codes requested. Try again later.' })
    })
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    await click('Email me a 6-digit code')
    expect(host.querySelector('[role="alert"]').textContent).toContain('Too many codes')
    expect(host.querySelector('#otp-withdrawal')).toBeNull()
  })

  it('a network failure is an alert, and the button is usable again', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
      throw new Error('offline')
    })
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    await click('Email me a 6-digit code')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/Network error/)
    expect([...host.querySelectorAll('button')].find((b) => b.textContent.includes('Email me a 6-digit code')).disabled).toBe(false)
  })

  it('an expired session is asked to log in again, not silently retried', async () => {
    authClient.auth.getSession.mockResolvedValue({ data: { session: null } })
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    await click('Email me a 6-digit code')
    expect(host.querySelector('[role="alert"]').textContent).toContain('log in again')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('"Send a new code" re-presses with reissue:true so the server voids the prior code', async () => {
    const issued = Date.now() - 61_000
    const expires = Date.now() + 9 * 60_000
    sessionStorage.setItem('ch-withdrawal-otp-meta', JSON.stringify({ draftId: 'd-1', otpIssuedAt: issued, draftExpiresAt: expires }))
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) {
        return reply(200, { draft: { id: 'd-1', app: 'carehub', amount: 500000, unit: 'kobo', destination_mask: '••••6789', draft_expires_at: new Date(expires).toISOString(), otp_issued_at: new Date(issued).toISOString() } })
      }
      if (String(url).includes('/withdrawal-pin/otp')) return reply(200, { ok: true, expiresInSeconds: 300 })
      return reply(404, {})
    })
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    await click('Send a new code')
    const [, init] = otpCalls()[0]
    expect(JSON.parse(init.body)).toMatchObject({ purpose: 'withdrawal', amount: 500000, reissue: true })
  })

  it('editing the amount after a code was sent resets to un-sent (fresh request required)', async () => {
    const seen = []
    await mount({ amount: 500000, bankCode: '058', accountNumber: '0123456789', onOtp: (v) => seen.push(v) })
    await click('Email me a 6-digit code')
    expect(host.querySelector('#otp-withdrawal')).toBeTruthy()
    await act(async () => { root.render(<Harness amount={600000} bankCode="058" accountNumber="0123456789" onOtp={(v) => seen.push(v)} />) })
    await act(async () => {})
    expect(host.querySelector('#otp-withdrawal')).toBeNull()
    expect([...host.querySelectorAll('button')].some((b) => b.textContent.includes('Email me a 6-digit code'))).toBe(true)
    expect(seen.at(-1)).toBe('')
  })

})
