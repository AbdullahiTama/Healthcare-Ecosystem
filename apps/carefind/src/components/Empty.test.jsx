// Empty is called with { title, description } across the shop and account screens, and with { message } elsewhere.
// Both must render: a prop the component silently ignores leaves the user looking at an icon and a button with
// no explanation of what they are looking at.
import { render, screen } from '@testing-library/react'
import { Empty } from './ui'

describe('Empty', () => {
  it('renders a title and description', () => {
    render(<Empty title="Your cart is empty" description="Browse our shop and add products to your cart" />)

    expect(screen.getByText('Your cart is empty')).toBeTruthy()
    expect(screen.getByText('Browse our shop and add products to your cart')).toBeTruthy()
  })

  it('renders a title on its own', () => {
    render(<Empty title="No saved addresses" />)

    expect(screen.getByText('No saved addresses')).toBeTruthy()
  })

  it('still renders a message (existing call sites)', () => {
    render(<Empty message="Nothing here yet" />)

    expect(screen.getByText('Nothing here yet')).toBeTruthy()
  })

  it('prefers an explicit message over a title and description', () => {
    render(<Empty message="Custom message" title="Ignored title" />)

    expect(screen.getByText('Custom message')).toBeTruthy()
    expect(screen.queryByText('Ignored title')).toBeNull()
  })

  it('still offers the action', () => {
    render(<Empty title="Your cart is empty" action="Continue Shopping" onAction={() => {}} />)

    expect(screen.getByRole('button', { name: 'Continue Shopping' })).toBeTruthy()
  })
})
