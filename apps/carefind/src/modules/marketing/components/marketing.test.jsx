import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SectionHeading from './SectionHeading'
import Marquee from './Marquee'
import LandingNav from './LandingNav'
import SiteFooter from './SiteFooter'
import CtaBand from './CtaBand'

export const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('SectionHeading', () => {
  it('renders eyebrow, title and optional intro', () => {
    wrap(<SectionHeading eyebrow="Mission" title="Built for one reason" intro="To connect people." />)
    expect(screen.getByText('Mission')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Built for one reason' })).toBeInTheDocument()
    expect(screen.getByText('To connect people.')).toBeInTheDocument()
  })

  it('omits intro paragraph when not provided', () => {
    const { unmount } = wrap(<SectionHeading eyebrow="Team" title="The people" />)
    expect(screen.queryByText('To connect people.')).not.toBeInTheDocument()
    unmount()
    wrap(<SectionHeading title="The people" />)
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The people' })).toBeInTheDocument()
  })
})

describe('Marquee', () => {
  it('renders items twice with the duplicate aria-hidden', () => {
    wrap(<Marquee items={['Pharmacies', 'Hospitals']} label="What you can find" />)
    const copies = screen.getAllByText('Pharmacies')
    expect(copies).toHaveLength(2)
    expect(copies[1].closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByLabelText('What you can find')).toBeInTheDocument()
  })
})

describe('LandingNav', () => {
  it('renders anchor links and both action buttons', () => {
    wrap(
      <LandingNav
        links={[{ label: 'Features', target: '#features' }, { label: 'About', target: '/about' }]}
        signInTo="/login"
        getStartedTo="/search"
      />,
    )
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features')
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
  })

  it('navigates to getStartedTo when Get started is clicked', () => {
    // Supplies its own MemoryRouter (for initialEntries + Routes), so bypasses
    // the wrap helper to avoid nesting two routers.
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LandingNav links={[]} signInTo="/login" getStartedTo="/search" />} />
          <Route path="/search" element={<div>search page marker</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByText('search page marker')).toBeInTheDocument()
  })

  // A navigation landmark, NOT a banner. The pages wrap this in <header>,
  // which is the banner; role="banner" here made a second one and suppressed
  // the nav's own implicit role, leaving the page with no navigation landmark.
  it('renders as a labelled navigation landmark, not a second banner', () => {
    wrap(<LandingNav links={[]} signInTo="/login" getStartedTo="/search" />)
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })
})

describe('SiteFooter', () => {
  it('renders brand line and links inside a contentinfo landmark', () => {
    wrap(
      <SiteFooter
        brandLine="(c) 2026 CareFind"
        links={[{ label: 'About', to: '/about' }, { label: 'Top', to: '#top' }]}
      />,
    )
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByText('(c) 2026 CareFind')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('link', { name: 'Top' })).toHaveAttribute('href', '#top')
  })
})

describe('CtaBand', () => {
  it('renders title, body and both actions as links', () => {
    wrap(
      <CtaBand
        title="Ready to find care?"
        body="Join thousands."
        primary={{ label: 'Start searching', to: '/search', variant: 'solid' }}
        secondary={{ label: 'Browse feed', to: '/feed', variant: 'ghost' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Ready to find care?' })).toBeInTheDocument()
    expect(screen.getByText('Join thousands.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start searching' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'Browse feed' })).toHaveAttribute('href', '/feed')
  })
})
