import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import LinkExpired from '../LinkExpired.jsx'

describe('LinkExpired (CareHub)', () => {
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

  const renderAt = (url) => act(async () => { root.render(<MemoryRouter initialEntries={[url]}><LinkExpired /></MemoryRouter>) })
  const link = (text) => [...host.querySelectorAll('a')].find(a => a.textContent.trim() === text)

  it('explains an expired reset / invitation link and offers a new one', async () => {
    await renderAt('/link-expired?reason=expired&kind=password_reset')
    const h1 = host.querySelector('h1')
    expect(h1.textContent).toBe('This link has expired')
    expect(document.activeElement).toBe(h1)
    expect(host.textContent).toContain('invitation links work once')
    expect(link('Request a new link').getAttribute('href')).toBe('/forgot-password')
    expect(link('Sign in').getAttribute('href')).toBe('/login')
    expect(link('Go to the home page').getAttribute('href')).toBe('/')
    expect(host.textContent).toContain('Ask them to send your invitation again')
  })

  it('an invalid link of unknown origin', async () => {
    await renderAt('/link-expired?reason=invalid&kind=auth')
    expect(host.querySelector('h1').textContent).toMatch(/can’t be used/)
    expect(link('Request a new link')).toBeTruthy()
  })

  it('a verification link only offers sign-in', async () => {
    await renderAt('/link-expired?reason=expired&kind=email_verification')
    expect(link('Request a new link')).toBeUndefined()
    expect(link('Sign in')).toBeTruthy()
  })

  it('never shows text from the URL', async () => {
    await renderAt('/link-expired?reason=x&kind=y&error_description=Call%20this%20number')
    expect(host.querySelector('h1').textContent).toBe('This link has expired')
    expect(host.textContent).not.toMatch(/Call this number/)
  })
})
