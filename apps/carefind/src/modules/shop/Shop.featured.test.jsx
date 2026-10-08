// The Shop tab opens on "Featured products" — one tidy row — and "View all" reveals the whole catalogue. Searching or
// filtering shows the results straight away, since a buyer who typed a query wants every match.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const state = vi.hoisted(() => ({ count: 6 }))
const makeRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, business_id: 'b1', ecommerce_price_kobo: 10000 + i, primary_image_url: null, prescription_required: false,
  active_at: '2026-01-01', ecommerce_category: 'cat',
  products: { id: `p${i}`, name: `Product ${i}`, stock: 10, reorder_level: 2, sale_type: 'retail', category: 'brand' },
  businesses: { id: 'b1', name: 'MediPlus Pharmacy', business_type: 'pharmacy', logo_url: null, lat: 6.5, lng: 3.4 },
}))

vi.mock('./shopRepository', () => ({ createShopRepository: () => ({ getActiveProducts: async () => makeRows(state.count) }) }))
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
        <WishlistProvider><CartProvider><Shop embedded filters={DEFAULTS} {...props} /></CartProvider></WishlistProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const grid = () => screen.getByRole('list', { name: 'Products' })
const ready = () => waitFor(() => expect(screen.getByRole('list', { name: 'Products' })).toBeInTheDocument())

describe('Shop featured products', () => {
  beforeEach(() => { state.count = 6 })

  it('opens on a featured heading and subtitle with the grid collapsed', async () => {
    mount()
    await ready()
    expect(screen.getByRole('heading', { name: 'Featured products' })).toBeInTheDocument()
    expect(screen.getByText('Health products from trusted sellers near you.')).toBeInTheDocument()
    expect(grid()).toHaveClass('mp-grid--collapsed')
  })

  it('View all expands the grid, and Show less collapses it again', async () => {
    mount()
    await ready()
    const toggle = screen.getByRole('button', { name: /view all/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', grid().id)

    fireEvent.click(toggle)
    expect(grid()).not.toHaveClass('mp-grid--collapsed')
    const less = screen.getByRole('button', { name: /show less/i })
    expect(less).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(less)
    expect(grid()).toHaveClass('mp-grid--collapsed')
  })

  it('shows every match straight away when the buyer has searched', async () => {
    mount({ query: 'product' })
    await ready()
    expect(grid()).not.toHaveClass('mp-grid--collapsed')
    expect(screen.queryByRole('button', { name: /view all/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Featured products' })).toBeNull()
  })

  it('shows every match straight away when a filter is active', async () => {
    mount({ filters: { ...DEFAULTS, priceMin: '1' } })
    await ready()
    expect(grid()).not.toHaveClass('mp-grid--collapsed')
    expect(screen.queryByRole('button', { name: /view all/i })).toBeNull()
  })

  it('shows every match straight away when a sale-type segment is chosen', async () => {
    mount({ segment: 'retail' })
    await ready()
    expect(grid()).not.toHaveClass('mp-grid--collapsed')
  })

  it('offers no View all when the catalogue already fits in the featured row', async () => {
    state.count = 3
    mount()
    await ready()
    expect(screen.queryByRole('button', { name: /view all/i })).toBeNull()
  })

  it('shows how far each seller is when the buyer’s location is known', async () => {
    mount({ userCoords: { lat: 6.51, lng: 3.4 } })
    await ready()
    expect(screen.getAllByText('Pharmacy • 1.1km away').length).toBeGreaterThan(0)
  })
})
