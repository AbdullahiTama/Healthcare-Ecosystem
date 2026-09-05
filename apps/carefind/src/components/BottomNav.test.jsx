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

function renderNav(initialPath) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNav />
    </MemoryRouter>
  )
}

describe('BottomNav (five destinations, always visible)', () => {
  beforeEach(() => {
    supabaseMock.from.mockClear()
  })

  it('renders the five core destinations including Create', () => {
    renderNav('/feed')
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MedMarket' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create post' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'News' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Browse' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Shop' })).not.toBeInTheDocument()
  })

  it('always shows Create irrespective of page', () => {
    for (const path of ['/search?tab=shop', '/news', '/profile', '/search']) {
      const { unmount } = renderNav(path)
      expect(screen.getByRole('button', { name: 'Create post' })).toBeInTheDocument()
      unmount()
    }
  })

  it('keeps MedMarket highlighted inside the marketplace', () => {
    renderNav('/search?tab=shop')
    expect(screen.getByRole('link', { name: 'MedMarket' }).style.color).toBe('rgb(14, 111, 90)')
    expect(screen.getByRole('link', { name: 'Home' }).style.color).toBe('rgb(139, 151, 143)')
  })

  it('keeps Home highlighted on the plain feed', () => {
    renderNav('/feed')
    expect(screen.getByRole('link', { name: 'Home' }).style.color).toBe('rgb(14, 111, 90)')
    expect(screen.getByRole('link', { name: 'News' }).style.color).toBe('rgb(139, 151, 143)')
  })
})
