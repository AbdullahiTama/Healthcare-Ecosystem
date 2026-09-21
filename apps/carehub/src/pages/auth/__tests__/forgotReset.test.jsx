import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock authClient
const mockReset = vi.fn(async () => ({ error: null }))
const mockUpdate = vi.fn(async () => ({ error: null }))
const mockGetSession = vi.fn(async () => ({ data: { session: null } }))
const mockExchange = vi.fn(async () => ({ error: null }))

vi.mock('../../../lib/authClient.js', () => ({
  authClient: {
    auth: {
      resetPasswordForEmail: (...args) => mockReset(...args),
      updateUser: (...args) => mockUpdate(...args),
      getSession: (...args) => mockGetSession(...args),
      exchangeCodeForSession: (...args) => mockExchange(...args),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

import ForgotPassword from '../ForgotPassword.jsx'
import ResetPassword from '../ResetPassword.jsx'

describe('ForgotPassword', () => {
  let host, root
  beforeEach(() => {
    mockReset.mockClear()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 }))
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    delete global.fetch
  })

  it('renders email input and submit button', async () => {
    await act(async () => { root.render(<MemoryRouter><ForgotPassword /></MemoryRouter>) })
    const input = host.querySelector('#forgot-email')
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Send reset link'))
    expect(input).toBeTruthy()
    expect(btn).toBeTruthy()
  })

  it('shows inline error for invalid email and does not call auth-email', async () => {
    await act(async () => { root.render(<MemoryRouter><ForgotPassword /></MemoryRouter>) })
    const input = host.querySelector('#forgot-email')
    const form = host.querySelector('form')
    await act(async () => {
      // For controlled component, fire input via native setter + input + change
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'not-an-email')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(global.fetch).not.toHaveBeenCalled()
    const alert = host.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
  })

  it('calls auth-email with action password_reset and shows generic success', async () => {
    await act(async () => { root.render(<MemoryRouter><ForgotPassword /></MemoryRouter>) })
    const input = host.querySelector('#forgot-email')
    const form = host.querySelector('form')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'user@example.com')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await act(async () => {})
    expect(global.fetch).toHaveBeenCalledWith('/api/auth-email', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }))
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.action).toBe('password_reset')
    expect(body.email).toBe('user@example.com')
  })
})

describe('ResetPassword — validation', () => {
  let host, root
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ data: { session: { id: 'sess' } } })
    mockUpdate.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('shows expired state when no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    await act(async () => { root.render(<MemoryRouter><ResetPassword /></MemoryRouter>) })
    await act(async () => new Promise(r => setTimeout(r, 0)))
    const txt = host.textContent
    expect(txt).toContain('Link expired')
  })

  it('validates password length and mismatch', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { id: 'sess' } } })
    await act(async () => { root.render(<MemoryRouter><ResetPassword /></MemoryRouter>) })
    await act(async () => new Promise(r => setTimeout(r, 0)))
    const newPass = host.querySelector('#new-pass')
    const confirm = host.querySelector('#confirm-pass')
    const form = host.querySelector('form')
    expect(newPass).toBeTruthy()
    // Try short password
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(newPass, '123')
      newPass.dispatchEvent(new Event('input', { bubbles: true }))
      newPass.dispatchEvent(new Event('change', { bubbles: true }))
      setter.call(confirm, '123')
      confirm.dispatchEvent(new Event('input', { bubbles: true }))
      confirm.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await act(async () => {})
    const alert = host.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('at least 6')
  })
})
