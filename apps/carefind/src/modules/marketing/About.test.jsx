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

  // jsdom does no layout, so this asserts the mechanism rather than the pixels:
  // the five-across grids must reflow on available width. They used to switch on
  // useBreakpoint's `isMobile`, true only below 768, so a 768px tablet got five
  // columns of ~93px each. A fixed repeat(5, …) track here is that bug returning.
  it('lays the five-across grids out on auto-fit tracks, not a breakpoint flag', () => {
    const { container } = renderAbout()
    const tracks = [...container.querySelectorAll('[style*="grid-template-columns"]')]
      .map((el) => el.style.gridTemplateColumns)

    expect(tracks).toHaveLength(4) // mission/vision, offerings, pillars, team
    tracks.forEach((track) => {
      expect(track).toMatch(/auto-fit/)
      expect(track).not.toMatch(/repeat\(5/)
    })
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
