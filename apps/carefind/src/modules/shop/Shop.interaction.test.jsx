// Shop must stay responsive under rapid interaction. A desktop user reported the page hanging and the mouse
// "shaking" after clicking around the shop; React's "Maximum update depth exceeded" was logged from <Shop>.
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rows = vi.hoisted(() => Array.from({ length: 22 }, (_, i) => ({
  id: `p${i}`, business_id: 'b1', ecommerce_price_kobo: 10000 + i, primary_image_url: null,
  prescription_required: false, active_at: '2026-01-01', ecommerce_category: 'cat',
  products: { id: `p${i}`, name: `Product ${i}`, price: 100 + i, stock: 10, sale_type: 'retail', category: 'brand' },
})))

const cartIconRenders = vi.hoisted(() => ({ n: 0 }))
vi.mock('lucide-react', async (orig) => {
  const m = await orig()
  const { createElement } = await import('react')
  return { ...m, ShoppingCart: (props) => { cartIconRenders.n++; return createElement(m.ShoppingCart, props) } }
})
vi.mock('./shopRepository', () => ({ createShopRepository: () => ({ getActiveProducts: async () => rows }) }))
vi.mock('./reviewsRepository', () => ({ reviewsRepository: { avg: async () => ({ avg: 0, count: 0 }) } }))
vi.mock('./wishlistRepository', () => ({
  wishlistRepository: {
    getAll: () => [], getAllAsync: async () => [],
    toggle: (id) => [id],
  },
}))
vi.mock('../../config/supabaseClient', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }))

import Shop from './Shop'
import { CartProvider } from './CartProvider'
import { WishlistProvider } from './WishlistProvider'

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WishlistProvider>
          <CartProvider>
            <Shop />
          </CartProvider>
        </WishlistProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Shop under rapid interaction', () => {
  let errors
  beforeEach(() => {
    localStorage.clear()
    errors = []
    vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(String(a[0])) })
  })
  afterEach(() => vi.restoreAllMocks())

  it('adding to the cart and toggling the wishlist repeatedly does not trigger a render loop', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Add Product \d+ to cart$/ }).length).toBeGreaterThan(5))

    const adds = screen.getAllByRole('button', { name: /^Add Product \d+ to cart$/ })
    for (let i = 0; i < 6; i++) { await act(async () => { fireEvent.click(adds[i]) }) }
    const wishes = screen.getAllByRole('button', { name: 'Add to wishlist' })
    for (let i = 0; i < 4; i++) { await act(async () => { fireEvent.click(wishes[i]) }) }

    expect(errors.filter((e) => /Maximum update depth/.test(e))).toEqual([])
    expect(JSON.parse(localStorage.getItem('carefind_cart'))).toHaveLength(6)
  }, 120000)

  it('clicking one product re-renders only that product, not the whole grid', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Add Product \d+ to cart$/ }).length).toBe(22))
    const adds = screen.getAllByRole('button', { name: /^Add Product \d+ to cart$/ })

    cartIconRenders.n = 0
    await act(async () => { fireEvent.click(adds[0]) })

    // One card's button + the header cart button may re-render; 22 means every card was re-rendered.
    expect(cartIconRenders.n).toBeLessThan(6)
  }, 120000)
})
