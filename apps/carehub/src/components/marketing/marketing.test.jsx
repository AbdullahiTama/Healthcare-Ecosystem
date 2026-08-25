import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SectionHeading from './SectionHeading'
import CtaBand from './CtaBand'
import LandingNav from './LandingNav'
import SiteFooter from './SiteFooter'

export const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('SectionHeading', () => {
  it('renders eyebrow, title and optional intro', () => {
    wrap(<SectionHeading eyebrow="Platform" title="One calm platform" intro="Everything in one place." />)
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'One calm platform' })).toBeInTheDocument()
    expect(screen.getByText('Everything in one place.')).toBeInTheDocument()
  })

  // Asserts the absence of the parts that were NOT passed, on a render that
  // omits them — querying for another render's eyebrow would pass vacuously.
  it('omits eyebrow and intro when absent', () => {
    const { container } = wrap(<SectionHeading title="Plain heading" />)
    expect(screen.getByRole('heading', { name: 'Plain heading' })).toBeInTheDocument()
    expect(container.querySelectorAll('div[data-reveal] > *')).toHaveLength(1)
    expect(container.querySelector('p')).toBeNull()
  })
})

describe('CtaBand', () => {
  it('renders title, body and actions as links', () => {
    wrap(
      <CtaBand
        title="Your patients are already searching."
        body="Register today."
        primary={{ label: 'Get started free', to: '/register', variant: 'solid' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Your patients are already searching.' })).toBeInTheDocument()
    expect(screen.getByText('Register today.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get started free' })).toHaveAttribute('href', '/register')
  })

  it('renders a secondary action when given one, and none when not', () => {
    const { unmount } = wrap(
      <CtaBand
        title="With both"
        primary={{ label: 'Primary', to: '/a', variant: 'solid' }}
        secondary={{ label: 'Secondary', to: '/b', variant: 'ghost' }}
      />,
    )
    expect(screen.getByRole('link', { name: 'Secondary' })).toHaveAttribute('href', '/b')
    unmount()

    wrap(<CtaBand title="Primary only" primary={{ label: 'Primary', to: '/a', variant: 'solid' }} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})

describe('LandingNav', () => {
  it('renders anchor links and action buttons', () => {
    wrap(
      <LandingNav
        links={[{ label: 'Features', target: '#features' }, { label: 'Pricing', target: '#pricing' }]}
        signInTo="/login"
        getStartedTo="/register"
      />,
    )
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features')
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
  })

  // A navigation landmark, NOT a banner. The page wraps this in <header>, which
  // is the banner; role="banner" here would make a second one and suppress the
  // nav's own implicit role, leaving no navigation landmark at all.
  it('renders as a labelled navigation landmark, not a second banner', () => {
    wrap(<LandingNav links={[]} signInTo="/login" getStartedTo="/register" />)
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  it('navigates to register from Get started', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LandingNav links={[]} signInTo="/login" getStartedTo="/register" />} />
          <Route path="/register" element={<div>register marker</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByText('register marker')).toBeInTheDocument()
  })
})

describe('SiteFooter', () => {
  it('renders brand line and links inside contentinfo', () => {
    wrap(
      <SiteFooter
        brandLine="© 2026 CareHub"
        links={[{ label: 'Features', to: '#features' }, { label: 'Support', to: 'mailto:support@carehub.ng' }]}
      />,
    )
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByText('© 2026 CareHub')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features')
    expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute('href', 'mailto:support@carehub.ng')
  })

  // The pre-rebuild footer linked "CareFind" to #carefind — a section that does
  // not exist on the page. An entry with no destination must render as text,
  // not as an anchor that goes nowhere.
  it('renders an entry with no destination as plain text, not a dead link', () => {
    wrap(<SiteFooter brandLine="© 2026 CareHub" links={[{ label: 'CareFind' }]} />)
    expect(screen.getByText('CareFind')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'CareFind' })).not.toBeInTheDocument()
  })
})
