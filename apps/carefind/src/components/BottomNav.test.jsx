import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav.jsx'
import { CREATE_PARAM } from '../modules/social-feed/createSelector.js'

// Reports the router's current location so a navigate() can be asserted.
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>
}

const supabaseMock = vi.hoisted(() => {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    gt: vi.fn(() => q),
    maybeSingle: vi.fn(() => q),
    then: (resolve) => resolve({ data: null, error: null }),
  }
  return { from: vi.fn(() => q) }
})
vi.mock('../config/supabaseClient', () => ({ supabase: supabaseMock }))
const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../providers/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))

function renderNav(initialPath, props = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNav {...props} />
    </MemoryRouter>
  )
}

describe('BottomNav (five destinations)', () => {
  beforeEach(() => {
    auth.user = null
    supabaseMock.from.mockClear()
  })

  it('renders the five core destinations', () => {
    renderNav('/')
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MedMarket' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'News' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create post' })).toBeInTheDocument()
    // Video access lives in the feed's top tab bar, not the bottom nav.
    expect(screen.queryByRole('link', { name: 'Videos' })).not.toBeInTheDocument()
  })

  it('keeps Home highlighted on the plain feed', () => {
    renderNav('/feed')
    // jsdom reports inline hex colors in rgb() form: tealDeep=#0E6F5A, textLight=#8B978F (unified)
    expect(screen.getByRole('link', { name: 'Home' }).style.color).toBe('rgb(14, 111, 90)')
    expect(screen.getByRole('link', { name: 'News' }).style.color).toBe('rgb(139, 151, 143)')
  })

  it('does not render the More overflow menu — logout lives on the Profile page', () => {
    auth.user = { id: 'u1' }
    renderNav('/feed')
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Wallet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Notifications' })).not.toBeInTheDocument()
  })

  // Issue #2 regression suite. The old behaviour scrolled to #post-composer
  // whenever it was in the DOM and only called onCompose as a fallback, so on
  // the feed — where the composer is always present — the create selector
  // never opened, and on every other page BottomNav was rendered with no
  // onCompose at all so the button just went to /feed and stopped there.
  it('opens the create selector when the feed provides onCompose', () => {
    auth.user = null
    const onCompose = vi.fn()
    renderNav('/feed', { onCompose })
    fireEvent.click(screen.getByRole('button', { name: 'Create post' }))
    expect(onCompose).toHaveBeenCalledTimes(1)
  })

  it('still opens the selector when the post composer is in the DOM', () => {
    auth.user = null
    const onCompose = vi.fn()
    const composer = document.createElement('div')
    composer.id = 'post-composer'
    composer.appendChild(document.createElement('textarea'))
    document.body.appendChild(composer)
    try {
      renderNav('/feed', { onCompose })
      fireEvent.click(screen.getByRole('button', { name: 'Create post' }))
      expect(onCompose).toHaveBeenCalledTimes(1)
    } finally {
      composer.remove()
    }
  })

  it('navigates to the feed carrying the create flag when no onCompose is given', () => {
    auth.user = null
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <BottomNav />
        <LocationProbe />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create post' }))
    expect(screen.getByTestId('location').textContent).toBe(`/feed?${CREATE_PARAM}=1`)
  })
})