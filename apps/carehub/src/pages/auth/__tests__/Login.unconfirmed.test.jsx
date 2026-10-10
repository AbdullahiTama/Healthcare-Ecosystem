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
    expect(JSON.parse(init.body)).toMatchObject({ action: 'password_reset', email: 'ada@x.test' })
    expect(host.textContent).toMatch(/new link is on its way/i)
  })
})
