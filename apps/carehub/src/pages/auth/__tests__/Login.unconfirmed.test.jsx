import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ signIn: vi.fn() }))
vi.mock('../../../lib/authClient', () => ({ authClient: { auth: { signInWithPassword: (...a) => h.signIn(...a) } } }))
vi.mock('../../../services/supabase', () => ({ resolveAccountByEmail: vi.fn() }))
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => ({ login: vi.fn() }) }))

import Login from '../Login.jsx'

const setValue = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const button = (host, re) => [...host.querySelectorAll('button')].find(b => re.test(b.textContent))
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

describe('sign-in with an unverified email', () => {
  let host, root
  beforeEach(() => {
    h.signIn.mockReset()
    h.signIn.mockResolvedValue({ data: { session: null }, error: { code: 'email_not_confirmed', message: 'Email not confirmed' } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    delete global.fetch
  })

  it('explains verification instead of claiming the password is wrong, and offers a resend', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await act(async () => { root.render(<MemoryRouter><Login /></MemoryRouter>) })

    await act(async () => {
      setValue(host.querySelector('input[type="email"]'), 'ada@x.test')
      setValue(host.querySelector('input[type="password"]'), 'whatever1')
    })
    await act(async () => { button(host, /^sign in$/i).click() })
    await flush()

    const alert = host.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toMatch(/verify your email/i)
    expect(host.textContent).not.toMatch(/incorrect email or password/i)

    await act(async () => { button(host, /send a new link/i).click() })
    await flush()
    expect(global.fetch).toHaveBeenCalled()
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/auth-email')
    // Without redirectTo the auth-email handler falls back to the bare origin and the link lands on `/`.
    expect(JSON.parse(init.body)).toEqual({
      action: 'password_reset', email: 'ada@x.test', redirectTo: `${window.location.origin}/reset-password?welcome=1`,
    })
    expect(host.textContent).toMatch(/new link is on its way/i)
  })

  const signInUnverified = async () => {
    await act(async () => { root.render(<MemoryRouter><Login /></MemoryRouter>) })
    await act(async () => {
      setValue(host.querySelector('input[type="email"]'), 'ada@x.test')
      setValue(host.querySelector('input[type="password"]'), 'whatever1')
    })
    await act(async () => { button(host, /^sign in$/i).click() })
    await flush()
    expect(host.textContent).toMatch(/verify your email/i)
  }

  it('removes the notice when the email is edited', async () => {
    await signInUnverified()
    await act(async () => { setValue(host.querySelector('input[type="email"]'), 'ada@y.test') })
    expect(host.textContent).not.toMatch(/verify your email/i)
    expect(host.textContent).not.toMatch(/new link is on its way/i)
  })

  it('shows only the validation error when the password is cleared and resubmitted', async () => {
    await signInUnverified()
    await act(async () => { setValue(host.querySelector('input[type="password"]'), '') })
    await act(async () => { button(host, /^sign in$/i).click() })
    await flush()
    expect(host.textContent).toMatch(/please enter your email and password/i)
    expect(host.textContent).not.toMatch(/verify your email/i)
  })

  it('shows only the credentials error after an invalid-credentials attempt', async () => {
    await signInUnverified()
    h.signIn.mockResolvedValue({ data: { session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    await act(async () => { setValue(host.querySelector('input[type="password"]'), 'otherpass1') })
    await act(async () => { button(host, /^sign in$/i).click() })
    await flush()
    expect(host.textContent).toMatch(/incorrect email or password/i)
    expect(host.textContent).not.toMatch(/verify your email/i)
  })
})

// A newly registered owner never learned the random password, and GoTrue checks the password before confirmation, so
// they get invalid_credentials, not email_not_confirmed. The hint must be identical for every address.
describe('sign-in with invalid credentials', () => {
  const HINT = 'Incorrect email or password. Just registered? Open the link we emailed you, or use "Forgot password" to get a new one.'
  let host, root
  beforeEach(() => {
    h.signIn.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  const attempt = async (emailValue) => {
    await act(async () => { root.render(<MemoryRouter><Login /></MemoryRouter>) })
    await act(async () => {
      setValue(host.querySelector('input[type="email"]'), emailValue)
      setValue(host.querySelector('input[type="password"]'), 'whatever1')
    })
    await act(async () => { button(host, /^sign in$/i).click() })
    await flush()
  }

  it('shows the same "Just registered?" hint for any address', async () => {
    h.signIn.mockResolvedValue({ data: { session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    await attempt('new-owner@x.test')
    expect(host.textContent).toContain(HINT)
    const first = host.textContent

    await attempt('nobody-here@x.test')
    expect(host.textContent).toContain(HINT)
    expect(host.textContent).toBe(first)
    expect(host.textContent).not.toMatch(/verify your email/i)
  })

  it('keeps the plain message for other sign-in failures', async () => {
    h.signIn.mockResolvedValue({ data: { session: null }, error: { code: 'over_request_rate_limit', message: 'Too many' } })
    await attempt('ada@x.test')
    expect(host.textContent).toContain('Incorrect email or password. Please try again.')
    expect(host.textContent).not.toMatch(/just registered/i)
  })
})
