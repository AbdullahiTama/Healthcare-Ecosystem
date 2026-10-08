import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LinkExpired from '../LinkExpired.jsx'

function renderAt(url) {
  return render(<MemoryRouter initialEntries={[url]}><LinkExpired /></MemoryRouter>)
}

describe('LinkExpired (CareFind)', () => {
  it('explains an expired password reset link and offers a new one', () => {
    renderAt('/link-expired?reason=expired&kind=password_reset')
    const h1 = screen.getByRole('heading', { level: 1, name: 'This link has expired' })
    expect(document.activeElement).toBe(h1)
    expect(screen.getByText(/Password reset links work once/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Request a new link$/ }).getAttribute('href')).toBe('/reset-password')
    expect(screen.getByRole('link', { name: /Sign in/ }).getAttribute('href')).toBe('/login')
    expect(screen.getByRole('link', { name: /Go home/ }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /on CareHub/ }).getAttribute('href')).toMatch(/\/forgot-password$/)
  })

  it('a link of unknown origin (it landed on the home page) still offers reset and sign-in', () => {
    renderAt('/link-expired?reason=invalid&kind=auth')
    expect(screen.getByRole('heading', { level: 1, name: /can’t be used/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Request a new link$/ })).toBeTruthy()
  })

  it('an expired verification link sends the user to sign in (which resends it)', () => {
    renderAt('/link-expired?reason=expired&kind=email_verification')
    expect(screen.getByText(/Verification links work once/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sign in/ }).getAttribute('href')).toBe('/login')
    expect(screen.queryByRole('link', { name: /Request a new link/ })).toBeNull()
  })

  it('never shows text from the URL; unknown values fall back to the defaults', () => {
    renderAt('/link-expired?reason=<b>pwned</b>&kind=evil&error_description=Call%20this%20number')
    expect(screen.getByRole('heading', { level: 1, name: 'This link has expired' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/pwned|Call this number/)
  })
})
