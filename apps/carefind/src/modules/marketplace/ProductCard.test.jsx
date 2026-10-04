import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../config/supabaseClient', () => ({ supabase: {} }))

import ProductCard from './ProductCard'

const row = (over = {}) => ({
  id: 'e1',
  business_id: 'b1',
  ecommerce_price_kobo: 650000,
  primary_image_url: null,
  prescription_required: false,
  products: { id: 'p1', name: 'ADVANT 16MG', stock: 20, reorder_level: 5, sale_type: 'retail' },
  businesses: { id: 'b1', name: 'MediPlus Pharmacy', business_type: 'pharmacy', logo_url: null, lat: 6.5, lng: 3.4 },
  ...over,
})

function mount(props = {}) {
  const onAddToCart = vi.fn()
  const onToggleWishlist = vi.fn()
  render(
    <MemoryRouter>
      <ProductCard row={row()} onAddToCart={onAddToCart} onToggleWishlist={onToggleWishlist} variant="shop" {...props} />
    </MemoryRouter>,
  )
  return { onAddToCart, onToggleWishlist }
}

describe('ProductCard (shop)', () => {
  it('shows the name, the price in naira and the seller', () => {
    mount()
    expect(screen.getByText('ADVANT 16MG')).toBeInTheDocument()
    expect(screen.getByText('₦6,500')).toBeInTheDocument()
    expect(screen.getByText('MediPlus Pharmacy')).toBeInTheDocument()
  })

  describe('stock badge', () => {
    it('says In stock when well stocked', () => {
      mount()
      expect(screen.getByText('In stock')).toBeInTheDocument()
    })

    it('says Low stock at or below the seller’s reorder level', () => {
      mount({ row: row({ products: { id: 'p1', name: 'X', stock: 5, reorder_level: 5 } }) })
      expect(screen.getByText('Low stock')).toBeInTheDocument()
    })

    it('says Out of stock and will not add to the cart', () => {
      const { onAddToCart } = mount({ row: row({ products: { id: 'p1', name: 'X', stock: 0, reorder_level: 5 } }) })
      expect(screen.getByText('Out of stock', { selector: 'span' })).toBeInTheDocument()
      const btn = screen.getByRole('button', { name: /X is out of stock/ })
      expect(btn).toBeDisabled()
      fireEvent.click(btn)
      expect(onAddToCart).not.toHaveBeenCalled()
    })
  })

  describe('seller', () => {
    it('marks a known seller as a verified (approved) vendor', () => {
      mount()
      expect(screen.getByLabelText('Verified seller')).toBeInTheDocument()
    })

    it('shows the seller type and the distance when the buyer’s location is known', () => {
      mount({ userCoords: { lat: 6.51, lng: 3.4 } })
      expect(screen.getByText('Pharmacy • 1.1km away')).toBeInTheDocument()
    })

    it('shows just the type when the buyer’s location is unknown', () => {
      mount({ userCoords: null })
      expect(screen.getByText('Pharmacy')).toBeInTheDocument()
      expect(screen.queryByText(/away/)).toBeNull()
    })

    it('falls back to a neutral seller, with no badge, when the business is hidden', () => {
      mount({ row: row({ businesses: null }) })
      expect(screen.getByText('CareFind seller')).toBeInTheDocument()
      expect(screen.queryByLabelText('Verified seller')).toBeNull()
    })
  })

  describe('rating', () => {
    it('shows the average and the review count', () => {
      mount({ rating: { avg: 4.8, count: 56 } })
      expect(screen.getByText('4.8')).toBeInTheDocument()
      expect(screen.getByText('(56 reviews)')).toBeInTheDocument()
    })

    it('uses the singular for one review', () => {
      mount({ rating: { avg: 5, count: 1 } })
      expect(screen.getByText('(1 review)')).toBeInTheDocument()
    })

    it('shows nothing rather than an invented rating when there are no reviews', () => {
      mount({ rating: { avg: 0, count: 0 } })
      expect(screen.queryByText(/review/)).toBeNull()
    })
  })

  it('keeps the prescription flag visible', () => {
    mount({ row: row({ prescription_required: true }) })
    expect(screen.getByText('Rx')).toBeInTheDocument()
  })

  it('adds the product to the cart with its price and seller', () => {
    const { onAddToCart } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Add ADVANT 16MG to cart' }))
    expect(onAddToCart).toHaveBeenCalledWith(expect.objectContaining({
      ecommerce_product_id: 'e1', product_name: 'ADVANT 16MG', unit_price_kobo: 650000, quantity: 1, vendor_id: 'b1',
    }))
  })

  it('toggles the wishlist and exposes its state', () => {
    const { onToggleWishlist } = mount({ wished: true })
    const heart = screen.getByRole('button', { name: 'Remove from wishlist' })
    expect(heart).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(heart)
    expect(onToggleWishlist).toHaveBeenCalledWith('e1')
  })

  it('links to the product page', () => {
    mount()
    expect(within(document.body).getAllByRole('link')[0]).toHaveAttribute('href', '/shop/e1')
  })
})
