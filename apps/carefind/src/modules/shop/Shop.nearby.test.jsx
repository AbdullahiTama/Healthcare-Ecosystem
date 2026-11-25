// MED Market's default order puts the seller nearest the user first (CODE_AUDIT A51), keeping in-stock items above
// sold-out ones; an explicit sort chosen by the user still wins.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rows = vi.hoisted(() => {
  const item = (id, name, lat, lng, over = {}) => ({
    id, business_id: 'b-' + id, ecommerce_price_kobo: 50000, ecommerce_category: 'Pain', prescription_required: false, active_at: '2026-01-01',
    products: { id: 'p-' + id, name, stock: 10, sale_type: 'retail', category: 'brand' },
    businesses: { id: 'b-' + id, name: name + ' Pharmacy', business_type: 'pharmacy', lat, lng },
    ...over,
  })
  return [
    item('lekki', 'Lekki Paracetamol', 6.4474, 3.5440),
    item('ikeja', 'Ikeja Paracetamol', 6.6018, 3.3515, { ecommerce_price_kobo: 90000 }),
    item('yaba', 'Yaba Paracetamol', 6.5140, 3.3720, { ecommerce_price_kobo: 70000 }),
  ]
})

vi.mock('./shopRepository', () => ({ createShopRepository: () => ({ getActiveProducts: async () => rows }) }))
vi.mock('./reviewsRepository', () => ({ reviewsRepository: { avg: async () => ({ avg: 0, count: 0 }) } }))
vi.mock('./wishlistRepository', () => ({ wishlistRepository: { getAll: () => [], getAllAsync: async () => [], toggle: (id) => [id] } }))
vi.mock('../../config/supabaseClient', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }))

import Shop from './Shop'
import { CartProvider } from './CartProvider'
import { WishlistProvider } from './WishlistProvider'

const DEFAULTS = { priceMin: '', priceMax: '', category: 'all', showRxOnly: false, inStockOnly: true, sort: 'popular' }
const YABA_USER = { lat: 6.5095, lng: 3.3711 }

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
const shown = () => screen.queryAllByRole('button', { name: /^Add .+ to cart$/ }).map((b) => b.getAttribute('aria-label').replace(/^Add | to cart$/g, ''))
const settled = () => waitFor(() => expect(shown().length).toBe(3))

describe('Shop: nearest seller first', () => {
  it('orders by distance from the user when the location is known', async () => {
    mount({ userCoords: YABA_USER })
    await settled()
    expect(shown()).toEqual(['Yaba Paracetamol', 'Ikeja Paracetamol', 'Lekki Paracetamol'])
  })

  it('keeps the newest-listed order without a location', async () => {
    mount({ userCoords: null })
    await settled()
    expect(shown()).toEqual(['Lekki Paracetamol', 'Ikeja Paracetamol', 'Yaba Paracetamol'])
  })

  it('leaves an explicit sort as chosen', async () => {
    mount({ userCoords: YABA_USER, filters: { ...DEFAULTS, sort: 'price_asc' } })
    await settled()
    expect(shown()).toEqual(['Lekki Paracetamol', 'Yaba Paracetamol', 'Ikeja Paracetamol'])
  })
})
