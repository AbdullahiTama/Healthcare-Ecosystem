// The wishlist page must never sit on "Loading wishlist..." when the catalogue cannot be read.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ getActiveProducts: null }))
vi.mock('./shopRepository', () => ({ createShopRepository: () => ({ getActiveProducts: (...a) => h.getActiveProducts(...a) }) }))
vi.mock('./wishlistRepository', () => ({ wishlistRepository: { getAll: () => ['p1'], getAllAsync: async () => ['p1'], toggle: (id) => [id] } }))
vi.mock('../../config/supabaseClient', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } } }))

import Wishlist from './Wishlist'
import { CartProvider } from './CartProvider'
import { WishlistProvider } from './WishlistProvider'

function mount() {
  return render(
    <MemoryRouter>
      <WishlistProvider><CartProvider><Wishlist /></CartProvider></WishlistProvider>
    </MemoryRouter>,
  )
}

describe('Wishlist page', () => {
  it('shows a retryable error instead of loading forever when products cannot be loaded', async () => {
    h.getActiveProducts = async () => { throw { code: '500', message: 'boom' } }
    mount()

    expect(await screen.findByText(/could not load your wishlist/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
    expect(screen.queryByText(/loading wishlist/i)).toBeNull()
  })

  it('shows saved products when the catalogue loads', async () => {
    h.getActiveProducts = async () => [{ id: 'p1', business_id: 'b1', ecommerce_price_kobo: 10000, primary_image_url: null, products: { id: 'p1', name: 'Paracetamol', price: 100, stock: 5 } }]
    mount()

    expect(await screen.findByText('Paracetamol')).toBeTruthy()
  })
})
