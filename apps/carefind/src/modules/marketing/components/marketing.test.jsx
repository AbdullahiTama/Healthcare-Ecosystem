import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SectionHeading from './SectionHeading'
import Marquee from './Marquee'

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
