// A visitor who is not signed in gets a 401 from the catalogue. The shop must say so and offer sign-in, not claim
// that no products match.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const h = vi.hoisted(() => ({ error: null }))
vi.mock('./shopRepository', () => ({
  createShopRepository: () => ({ getActiveProducts: async () => { throw h.error } }),
}))
vi.mock('./reviewsRepository', () => ({ reviewsRepository: { avg: async () => ({ avg: 0, count: 0 }) } }))
vi.mock('./wishlistRepository', () => ({ wishlistRepository: { getAll: () => [], getAllAsync: async () => [], toggle: (id) => [id] } }))
vi.mock('../../config/supabaseClient', () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null } }) } } }))

import Shop from './Shop'
import { CartProvider } from './CartProvider'
import { WishlistProvider } from './WishlistProvider'

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WishlistProvider><CartProvider><Shop /></CartProvider></WishlistProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Shop for a visitor who is not signed in', () => {
  it('asks the visitor to sign in instead of showing an empty catalogue', async () => {
    h.error = { code: '42501', message: 'permission denied for table ecommerce_products' }
    mount()

    expect(await screen.findByText(/sign in to browse the shop/i)).toBeTruthy()
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link.getAttribute('href')).toBe('/login')
    expect(screen.queryByText(/no products match/i)).toBeNull()
  })

  it('still shows the retryable error for any other failure', async () => {
    h.error = { code: '500', message: 'boom' }
    mount()

    expect(await screen.findByText(/could not load shop products/i)).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy())
    expect(screen.queryByText(/sign in to browse the shop/i)).toBeNull()
  })
})
