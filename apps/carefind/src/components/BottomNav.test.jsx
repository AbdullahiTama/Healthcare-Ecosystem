import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BottomNav from './BottomNav.jsx'

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

  it('shows the More overflow menu with authenticated-only destinations', () => {
    auth.user = { id: 'u1' }
    renderNav('/feed')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('link', { name: 'Wallet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('hides the More menu for signed-out users', () => {
    auth.user = null
    renderNav('/')
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  })

  it('falls back to onCompose when tapped on the feed and the composer is not in the DOM', () => {
    auth.user = null
    const onCompose = vi.fn()
    renderNav('/feed', { onCompose })
    fireEvent.click(screen.getByRole('button', { name: 'Create post' }))
    expect(onCompose).toHaveBeenCalledTimes(1)
  })
})