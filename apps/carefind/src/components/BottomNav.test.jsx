import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

function renderNav(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNav />
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
    // jsdom reports inline hex colors in rgb() form: tealDeep=#0E6F5A, textLight=#6B7B73
    expect(screen.getByRole('link', { name: 'Home' }).style.color).toBe('rgb(14, 111, 90)')
    expect(screen.getByRole('link', { name: 'News' }).style.color).toBe('rgb(107, 123, 115)')
  })
})