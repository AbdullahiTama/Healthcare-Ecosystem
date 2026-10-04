// When Shop is embedded in the Search page, the Filters sheet (owned by Search) is the only filter UI — Shop's own
// controls are hidden. The sheet's values must therefore reach Shop and actually narrow/sort the catalogue.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rows = vi.hoisted(() => [
  { id: 'b', business_id: 'b1', ecommerce_price_kobo: 150000, ecommerce_category: 'Antibiotics', prescription_required: true, active_at: '2026-01-02',
    products: { id: 'pb', name: 'Bravo', stock: 10, sale_type: 'retail', category: 'brand' } },
  { id: 'a', business_id: 'b1', ecommerce_price_kobo: 50000, ecommerce_category: 'Pain', prescription_required: false, active_at: '2026-01-03',
    products: { id: 'pa', name: 'Alpha', stock: 10, sale_type: 'retail', category: 'brand' } },
  { id: 'c', business_id: 'b1', ecommerce_price_kobo: 20000, ecommerce_category: 'Pain', prescription_required: false, active_at: '2026-01-01',
    products: { id: 'pc', name: 'Charlie', stock: 0, sale_type: 'retail', category: 'brand' } },
])

vi.mock('./shopRepository', () => ({ createShopRepository: () => ({ getActiveProducts: async () => rows }) }))
vi.mock('./reviewsRepository', () => ({ reviewsRepository: { avg: async () => ({ avg: 0, count: 0 }) } }))
vi.mock('./wishlistRepository', () => ({ wishlistRepository: { getAll: () => [], getAllAsync: async () => [], toggle: (id) => [id] } }))
vi.mock('../../config/supabaseClient', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }))

import Shop from './Shop'
import { CartProvider } from './CartProvider'
import { WishlistProvider } from './WishlistProvider'

const DEFAULTS = { priceMin: '', priceMax: '', category: 'all', showRxOnly: false, inStockOnly: true, sort: 'popular' }

function mount(props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WishlistProvider><CartProvider><Shop embedded {...props} /></CartProvider></WishlistProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The grid cards expose one "Add <name> to cart" button each, in render order.
const shown = () => screen.queryAllByRole('button', { name: /^Add .+ to cart$/ }).map((b) => b.getAttribute('aria-label').replace(/^Add | to cart$/g, ''))
const settled = () => waitFor(() => expect(shown().length).toBeGreaterThan(0))

describe('Shop embedded: filters from the Search sheet', () => {
  it('without a filters prop keeps the old defaults (in stock only)', async () => {
    mount()
    await settled()
    expect(shown()).toEqual(['Bravo', 'Alpha'])
  })

  it('applies the min and max price (entered in naira)', async () => {
    mount({ filters: { ...DEFAULTS, priceMin: '1000' } })
    await settled()
    expect(shown()).toEqual(['Bravo'])
  })

  it('applies the max price', async () => {
    mount({ filters: { ...DEFAULTS, priceMax: '600' } })
    await settled()
    expect(shown()).toEqual(['Alpha'])
  })

  it('applies Rx only', async () => {
    mount({ filters: { ...DEFAULTS, showRxOnly: true } })
    await settled()
    expect(shown()).toEqual(['Bravo'])
  })

  it('includes out-of-stock products when "in stock only" is switched off', async () => {
    mount({ filters: { ...DEFAULTS, inStockOnly: false } })
    // The sold-out product appears, but its button says so and cannot be used to add it.
    const soldOut = await screen.findByRole('button', { name: 'Charlie is out of stock' })
    expect(soldOut).toBeDisabled()
    expect(shown()).toEqual(['Bravo', 'Alpha'])
  })

  it('applies the category', async () => {
    mount({ filters: { ...DEFAULTS, category: 'Antibiotics' } })
    await settled()
    expect(shown()).toEqual(['Bravo'])
  })

  it('sorts by price, low to high and high to low', async () => {
    const { unmount } = mount({ filters: { ...DEFAULTS, sort: 'price_asc' } })
    await settled()
    expect(shown()).toEqual(['Alpha', 'Bravo'])
    unmount()

    mount({ filters: { ...DEFAULTS, sort: 'price_desc' } })
    await settled()
    expect(shown()).toEqual(['Bravo', 'Alpha'])
  })

  it('reports its categories so the sheet can offer them', async () => {
    const onCategoriesChange = vi.fn()
    mount({ filters: DEFAULTS, onCategoriesChange })
    await waitFor(() => expect(onCategoriesChange).toHaveBeenCalledWith(['all', 'Antibiotics', 'Pain']))
  })
})
