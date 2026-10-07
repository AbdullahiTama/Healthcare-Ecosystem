// My Orders rendered bare (no back link, no navigation): a shopper on a phone had no way out but the browser's back button.
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const viewport = vi.hoisted(() => ({ isMobile: false }))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: viewport.isMobile, isTablet: false }) }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div data-testid="app-shell">{children}</div> }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => <nav data-testid="bottom-nav" /> }))
vi.mock('./orderRepository', () => ({ orderRepository: { getByCustomer: async () => [
  { id: 'o1', order_ref: 'CF-1', created_at: '2026-10-06T09:00:00Z', status: 'delivered', total_kobo: 500000, order_items: [{ product_name: 'Thermometer', quantity: 1, unit_price_kobo: 500000, ecommerce_product_id: 'e1' }] },
] } }))

import OrderList from './OrderList'
import { CartProvider } from './CartProvider'

function mount(initialEntries = ['/orders']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CartProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/orders" element={<OrderList />} />
            <Route path="/search" element={<div>Shop page</div>} />
            <Route path="/profile" element={<div>Profile page</div>} />
          </Routes>
        </MemoryRouter>
      </CartProvider>
    </QueryClientProvider>,
  )
}

describe('My Orders', () => {
  beforeEach(() => { viewport.isMobile = false; localStorage.clear() })

  it('sits in the site shell on desktop, with a back link', async () => {
    mount()
    expect(await screen.findByText('My Orders')).toBeTruthy()
    expect(screen.getByTestId('app-shell')).toBeTruthy()
    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy()
  })

  it('on a phone has the bottom navigation and a finger-sized back link', async () => {
    viewport.isMobile = true
    mount()
    expect(await screen.findByText('My Orders')).toBeTruthy()
    expect(screen.queryByTestId('app-shell')).toBeNull()
    expect(screen.getByTestId('bottom-nav')).toBeTruthy()
    expect(screen.getByRole('button', { name: /back/i }).style.minHeight).toBe('44px')
  })

  it('opened directly (no in-app history), Back goes to the shop', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /back/i }))
    expect(await screen.findByText('Shop page')).toBeTruthy()
  })
})
