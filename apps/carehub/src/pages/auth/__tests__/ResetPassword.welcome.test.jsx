import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/authClient', () => ({
  authClient: { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    exchangeCodeForSession: async () => ({ error: null }),
    updateUser: vi.fn(), signOut: vi.fn(),
  } },
}))

import ResetPassword from '../ResetPassword.jsx'

describe('ResetPassword', () => {
  let host, root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })
  const renderAt = async (entry) => {
    await act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><ResetPassword /></MemoryRouter>) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
  const submitLabel = () => host.querySelector('button[type="submit"]')?.textContent

  it('shows the welcome copy for a new owner', async () => {
    await renderAt('/reset-password?welcome=1')
    expect(host.textContent).toMatch(/email verified/i)
    expect(host.textContent).toMatch(/choose a password to finish creating your account/i)
    expect(submitLabel()).toBe('Save password')
  })

  it('keeps the reset copy otherwise', async () => {
    await renderAt('/reset-password')
    expect(host.textContent).toMatch(/set new password/i)
    expect(host.textContent).not.toMatch(/email verified/i)
    expect(submitLabel()).toBe('Update password')
  })
})
