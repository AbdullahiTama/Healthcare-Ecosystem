import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Landing from '../Landing'

// Render under reduced-motion so GSAP/ScrollTrigger never initialise in jsdom;
// structural output is identical either way because the hook no-ops.
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const renderLanding = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<div>register marker</div>} />
      <Route path="/apply-agent" element={<div>agent marker</div>} />
      <Route path="/login" element={<div>login marker</div>} />
    </Routes>
  </MemoryRouter>,
)

describe('CareHub Landing', () => {
  it('renders hero headline and primary CTAs', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Run your healthcare business')
    expect(screen.getAllByRole('link', { name: /see pricing/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders features, steps, pricing and referral sections', () => {
    renderLanding()
    expect(screen.getByRole('heading', { name: /one platform for the counter/i })).toBeInTheDocument()
    expect(screen.getByText('Register your business')).toBeInTheDocument()
    expect(screen.getByText(/Plain pricing in Naira/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Referral Agent/i })).toBeInTheDocument()
  })

  it('navigates to register from the hero CTA', () => {
    renderLanding()
    fireEvent.click(screen.getAllByRole('link', { name: /get started free/i })[0])
    expect(screen.getByText('register marker')).toBeInTheDocument()
  })

  it('navigates to the agent application from the referral CTA', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('link', { name: /apply to cover your area/i }))
    expect(screen.getByText('agent marker')).toBeInTheDocument()
  })

  // The point of the rebuild, and the assertion that must never go green by
  // accident: the page carried three invented quotes with invented names and
  // cities, and a marquee headlined "Trusted by healthcare businesses across
  // Nigeria" that was really scrolling the list of business CATEGORIES the
  // product supports.
  it('does not render fabricated testimonials or the false trust marquee', () => {
    renderLanding()
    expect(screen.queryByText('Adaeze Okafor')).not.toBeInTheDocument()
    expect(screen.queryByText('Dr. Musa Bello')).not.toBeInTheDocument()
    expect(screen.queryByText('Ifeoma Eze')).not.toBeInTheDocument()
    expect(screen.queryByText(/Loved by healthcare teams/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Trusted by healthcare businesses/i)).not.toBeInTheDocument()
  })

  // Every pricing plan must offer a route to act on, Enterprise included.
  it('gives every pricing plan a working call to action', () => {
    renderLanding()
    const plans = ['Basic', 'Growth', 'Hospital']
    plans.forEach((plan) => {
      expect(screen.getByRole('link', { name: `Start with ${plan}` })).toHaveAttribute('href', '/register')
    })
    expect(screen.getByRole('link', { name: 'Talk to us' })).toHaveAttribute('href', '/register')
  })

  // The footer used to link "CareFind" at #carefind — a section that is not on
  // the page. It is a label now, not a link that goes nowhere.
  it('renders the footer CareFind entry as text and the support address as mailto', () => {
    renderLanding()
    expect(screen.getByText('CareFind')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'CareFind' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'support@carehub.ng' }))
      .toHaveAttribute('href', 'mailto:support@carehub.ng')
  })
})
