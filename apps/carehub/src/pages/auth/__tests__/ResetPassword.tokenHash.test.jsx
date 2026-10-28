// Reset links for the PKCE client: ?token_hash= links verified on submit, and old Supabase verify links (session in
// the URL hash) adopted instead of rejected as "expired".
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  verifyOtp: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(), setSession: vi.fn(), getSession: vi.fn(), getUser: vi.fn(),
}))
vi.mock('../../../lib/authClient', () => ({
  authClient: { auth: {
    verifyOtp: (...a) => h.verifyOtp(...a),
    updateUser: (...a) => h.updateUser(...a),
    signOut: (...a) => h.signOut(...a),
    setSession: (...a) => h.setSession(...a),
    getSession: (...a) => h.getSession(...a),
    getUser: (...a) => h.getUser(...a),
    exchangeCodeForSession: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  } },
}))

import ResetPassword from '../ResetPassword.jsx'

let host, root, warn
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function openAt(href) {
  window.history.replaceState({}, '', href)
  const path = href.replace(/#.*$/, '')
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><ResetPassword /></MemoryRouter>) })
  await flush(); await flush()
}
async function submit(pass = 'NewPass123!') {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  for (const id of ['#new-pass', '#confirm-pass']) {
    const el = host.querySelector(id)
    await act(async () => { set.call(el, pass); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  await flush()
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'u1' } }, user: { id: 'u1', email_confirmed_at: '2026-10-01' } }, error: null })
  h.updateUser.mockResolvedValue({ error: null })
  h.signOut.mockResolvedValue({})
  h.setSession.mockResolvedValue({ error: null })
  h.getSession.mockResolvedValue({ data: { session: null } })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); warn.mockRestore(); window.history.replaceState({}, '', '/') })

describe('ResetPassword with a token-hash link', () => {
  it('shows the form without using the token, then verifies it on submit and saves the password', async () => {
    await openAt('/reset-password?token_hash=abc123&type=recovery')
    expect(host.querySelector('#new-pass')).toBeTruthy()
    expect(h.verifyOtp).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
    await submit()
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'recovery' })
    expect(h.updateUser).toHaveBeenCalledWith({ password: 'NewPass123!' })
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'global' })
    expect(host.textContent).toContain('Password updated!')
  })

  it('a used or expired token shows "Link expired" on submit and changes nothing', async () => {
    h.verifyOtp.mockResolvedValue({ data: {}, error: { message: 'Token has expired or is invalid' } })
    await openAt('/reset-password?token_hash=old&type=recovery')
    await submit()
    expect(host.textContent).toContain('Link expired')
    expect(h.updateUser).not.toHaveBeenCalled()
  })

  it('keeps ?welcome=1 copy and refuses an owner whose email the link did not confirm', async () => {
    h.verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'u1' } }, user: { id: 'u1', email_confirmed_at: null } }, error: null })
    await openAt('/reset-password?welcome=1&token_hash=abc&type=recovery')
    expect(host.textContent).toContain('Finish setting up')
    expect(window.location.search).toBe('?welcome=1')
    await submit()
    expect(host.textContent).toMatch(/could not verify your email/i)
    expect(h.updateUser).not.toHaveBeenCalled()
  })
})

describe('ResetPassword with an older Supabase verify link', () => {
  it('adopts the session from the URL hash instead of calling it expired, and clears the tokens', async () => {
    h.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    await openAt('/reset-password#access_token=at&refresh_token=rt&type=recovery')
    expect(h.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
    expect(window.location.hash).toBe('')
    expect(host.querySelector('#new-pass')).toBeTruthy()
  })

  it('a link Supabase rejected (otp_expired) shows "Link expired"', async () => {
    await openAt('/reset-password#error=access_denied&error_code=otp_expired')
    expect(host.textContent).toContain('Link expired')
    expect(h.setSession).not.toHaveBeenCalled()
  })
})
