import { render, screen } from '@testing-library/react'
import ShopHero from './ShopHero'

describe('ShopHero', () => {
  it('names the marketplace and says what it offers', () => {
    render(<ShopHero />)
    expect(screen.getByRole('heading', { name: 'Find trusted health products near you' })).toBeInTheDocument()
    expect(screen.getByText(/compare prices, check availability and buy from verified pharmacies/i)).toBeInTheDocument()
  })

  it('lists the three trust points', () => {
    render(<ShopHero />)
    const list = screen.getByRole('list', { name: 'Why shop on CareFind' })
    expect(list.querySelectorAll('li')).toHaveLength(3)
    expect(screen.getByText('Verified sellers')).toBeInTheDocument()
    expect(screen.getByText('Fast & reliable')).toBeInTheDocument()
    expect(screen.getByText('Compare prices')).toBeInTheDocument()
  })

  it('treats the portrait as decoration, not content', () => {
    const { container } = render(<ShopHero />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('is a labelled region', () => {
    render(<ShopHero />)
    expect(screen.getByRole('region', { name: 'Find trusted health products near you' })).toBeInTheDocument()
  })
})
