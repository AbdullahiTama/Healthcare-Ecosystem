import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import About from './About'

// Render under reduced-motion so GSAP/ScrollTrigger never initialize in jsdom;
// structural output is identical either way (hook no-ops). Same setup as
// Home.test.jsx.
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const renderAbout = () => render(<MemoryRouter><About /></MemoryRouter>)

describe('About', () => {
  it('renders hero and mission/vision sections', () => {
    renderAbout()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connecting people to better healthcare.')
    expect(screen.getByRole('heading', { name: /our mission/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /our vision/i })).toBeInTheDocument()
  })

  // Scoped to #story rather than queried off the whole page: the hero's quick
  // facts also print "2020", so an unscoped getByText would match two elements
  // and throw regardless of whether the timeline survived the rebuild. Scoping
  // is what makes this assert the thing it claims to.
  it('preserves the story timeline verbatim', () => {
    const { container } = renderAbout()
    const story = within(container.querySelector('#story'))
    expect(story.getByText('2020')).toBeInTheDocument()
    expect(story.getByText('The WhatsApp group')).toBeInTheDocument()
    expect(story.getByText('HATMA Brandtech Limited')).toBeInTheDocument()
    expect(story.getByText('CareFind arrives')).toBeInTheDocument()
  })

  it('preserves the team verbatim', () => {
    const { container } = renderAbout()
    const team = within(container.querySelector('#team'))
    expect(team.getByText('Haruna Abdullahi Tama')).toBeInTheDocument()
    expect(team.getByText('Pharmacist John Joseph')).toBeInTheDocument()
    expect(team.getByText('Maryam Abdul Aziz')).toBeInTheDocument()
    expect(team.getByText('Unaisa Abdullahi')).toBeInTheDocument()
    expect(team.getByText('Bolu Zulaikha')).toBeInTheDocument()
  })

  it('composes on the shared primitives: nav, CTA band and footer', () => {
    renderAbout()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CareFind home' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Our story is just beginning.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start searching/i })).toBeInTheDocument()
    // Not getByRole('contentinfo'): SiteFooter's <footer> is a descendant of
    // <main>, which strips the implicit landmark role. Assert the content.
    // Anchored on the copyright, which only the footer carries — the hero
    // badge repeats the "healthcare social platform by HATMA" wording.
    expect(screen.getByText(/© 2026 CareFind/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'For businesses' })).toBeInTheDocument()
  })
})
