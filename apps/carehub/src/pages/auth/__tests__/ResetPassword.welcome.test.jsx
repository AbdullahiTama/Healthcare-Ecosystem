import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ getUser: vi.fn() }))

vi.mock('../../../lib/authClient', () => ({
  authClient: { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    getUser: (...a) => h.getUser(...a),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    exchangeCodeForSession: async () => ({ error: null }),
    updateUser: vi.fn(), signOut: vi.fn(),
  } },
}))

import ResetPassword from '../ResetPassword.jsx'

describe('ResetPassword', () => {
  let host, root, warn
  beforeEach(() => {
    h.getUser.mockReset()
    h.getUser.mockResolvedValue({ data: { user: { id: 'u1', email_confirmed_at: '2026-10-10T10:00:00Z' } }, error: null })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    warn.mockRestore()
  })
  const renderAt = async (entry) => {
    await act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><ResetPassword /></MemoryRouter>) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
  const submitLabel = () => host.querySelector('button[type="submit"]')?.textContent
  const expectWelcomeForm = () => {
    expect(host.textContent).toMatch(/email verified/i)
    expect(host.textContent).toMatch(/choose a password to finish creating your account/i)
    expect(submitLabel()).toBe('Save password')
    expect(host.textContent).not.toMatch(/could not verify your email/i)
  }

  it('shows the welcome copy for a new owner whose email is confirmed', async () => {
    await renderAt('/reset-password?welcome=1')
    expect(h.getUser).toHaveBeenCalled()
    expectWelcomeForm()
  })

  it('does not claim the email is verified when the link did not confirm it', async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'ada@x.test', email_confirmed_at: null } }, error: null })
    await renderAt('/reset-password?welcome=1')
    expect(host.textContent).toMatch(/We could not verify your email/)
    expect(host.textContent).toMatch(/Open the link in your most recent email, or request a new one from the sign-in page\./)
    expect(host.textContent).not.toMatch(/email verified/i)
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('input[type="password"]')).toBeNull()
    expect(host.querySelector('a[href="/login"]')).toBeTruthy()
    expect(warn).toHaveBeenCalledWith('[reset] welcome link did not confirm the email')
    // No address or token in the log line.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('ada@x.test')
  })

  it('proceeds normally when the confirmation lookup returns an error', async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'network' } })
    await renderAt('/reset-password?welcome=1')
    expectWelcomeForm()
  })

  it('proceeds normally when the confirmation lookup throws', async () => {
    h.getUser.mockRejectedValue(new Error('offline'))
    await renderAt('/reset-password?welcome=1')
    expectWelcomeForm()
  })

  it('keeps the reset copy otherwise, without a confirmation lookup', async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: 'u1', email_confirmed_at: null } }, error: null })
    await renderAt('/reset-password')
    expect(host.textContent).toMatch(/set new password/i)
    expect(host.textContent).not.toMatch(/email verified/i)
    expect(host.textContent).not.toMatch(/could not verify your email/i)
    expect(submitLabel()).toBe('Update password')
    expect(h.getUser).not.toHaveBeenCalled()
  })
})
