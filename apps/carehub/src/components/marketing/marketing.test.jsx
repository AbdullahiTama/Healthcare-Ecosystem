import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SectionHeading from './SectionHeading'
import CtaBand from './CtaBand'

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
