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
function Harness({ action = 'withdrawal', onOtp }) {
  const [otp, setOtp] = useState('')
  return <WithdrawalOtpField action={action} value={otp} onChange={(v) => { setOtp(v); onOtp?.(v) }} />
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
  authClient.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-test' } } })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('WithdrawalOtpField', () => {
  it('starts with only a send button; nothing is requested until the owner asks', async () => {
    await mount()
    expect(host.textContent).toContain('Email me a 6-digit code')
    expect(host.querySelector('#otp-withdrawal')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests a code for its action with the session token, then reveals the input', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }))
    await mount({ action: 'withdrawal' })
    await click('Email me a 6-digit code')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/withdrawal-pin-otp')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ action: 'withdrawal' })
    expect(host.querySelector('#otp-withdrawal')).toBeTruthy()
    expect(host.textContent).toContain('Code sent')
    expect([...host.querySelectorAll('button')].some((b) => b.textContent.includes('Send a new code'))).toBe(true)
  })

  it('keeps only digits (max 6) and hands them to the parent', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }))
    const seen = []
    await mount({ onOtp: (v) => seen.push(v) })
    await click('Email me a 6-digit code')
    await type('otp-withdrawal', '12ab34567')
    expect(seen.at(-1)).toBe('123456')
  })

  it('surfaces the server rate limit (3 codes/hour) as an alert and never reveals a code', async () => {
    fetchMock.mockResolvedValue(reply(429, { error: 'Too many codes requested. Try again later.' }))
    await mount()
    await click('Email me a 6-digit code')
    expect(host.querySelector('[role="alert"]').textContent).toContain('Too many codes')
    expect(host.querySelector('#otp-withdrawal')).toBeNull()
  })

  it('a network failure is an alert, and the button is usable again', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    await mount()
    await click('Email me a 6-digit code')
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/Network error/)
    expect([...host.querySelectorAll('button')].find((b) => b.textContent.includes('Email me a 6-digit code')).disabled).toBe(false)
  })

  it('an expired session is asked to log in again, not silently retried', async () => {
    authClient.auth.getSession.mockResolvedValue({ data: { session: null } })
    await mount()
    await click('Email me a 6-digit code')
    expect(host.querySelector('[role="alert"]').textContent).toContain('log in again')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests the action it was given (set_pin for the set-PIN flow)', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }))
    await mount({ action: 'set_pin' })
    await click('Email me a 6-digit code')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'set_pin' })
    expect(host.querySelector('#otp-set_pin')).toBeTruthy()
  })
})
