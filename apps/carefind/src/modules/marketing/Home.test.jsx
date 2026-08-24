import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

// Render under reduced-motion so GSAP/ScrollTrigger never initialize in jsdom;
// structural output is identical either way (hook no-ops).
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>)

describe('Home (CareFind landing)', () => {
  it('renders hero headline and both CTAs', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Find the care you need')
    // Hero AND closing CtaBand both offer these actions — assert existence, not uniqueness.
    expect(screen.getAllByRole('link', { name: 'Start searching' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('link', { name: 'Browse feed' }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the true category strip, features and steps', () => {
    renderHome()
    expect(screen.getByLabelText(/categories of care/i)).toBeInTheDocument()
    // Marquee duplicates its track for the loop; assert one visible copy set.
    expect(screen.getAllByText('Pharmacies').length).toBe(2)
    expect(screen.getByRole('heading', { name: /make informed health decisions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Search/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Compare/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Connect/i })).toBeInTheDocument()
  })

  it('does not render fabricated social proof', () => {
    renderHome()
    expect(screen.queryByText(/Sarah K\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/Lagos State Hospital/)).not.toBeInTheDocument()
    expect(screen.queryByText(/MedPlus Pharmacy/)).not.toBeInTheDocument()
  })
})
