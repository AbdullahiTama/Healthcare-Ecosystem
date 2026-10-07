// The cart page must look like part of the app (site shell, a way back to shopping), not a stranded form.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../components/layout/AppShell.jsx', () => ({
  default: ({ children }) => <div data-testid="app-shell">{children}</div>,
}))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => <nav data-testid="bottom-nav" /> }))
const viewport = vi.hoisted(() => ({ isMobile: false }))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: viewport.isMobile, isTablet: false }) }))

import Cart from './Cart'
import { CartProvider } from './CartProvider'

const seed = (items) => localStorage.setItem('carefind_cart', JSON.stringify(items))
const item = { ecommerce_product_id: 'p1', product_name: 'Paracetamol', unit_price_kobo: 50000, quantity: 2 }

function mount() {
  return render(
    <MemoryRouter>
      <CartProvider>
        <Cart />
      </CartProvider>
    </MemoryRouter>,
  )
}

describe('Cart page', () => {
  beforeEach(() => { localStorage.clear(); viewport.isMobile = false })

  it('renders inside the site shell when the cart has items', () => {
    seed([item])
    mount()

    expect(screen.getByTestId('app-shell').textContent).toContain('Shopping Cart')
  })

  it('renders inside the site shell when the cart is empty', () => {
    mount()

    expect(screen.getByTestId('app-shell').textContent).toContain('Your cart is empty')
  })

  it('links back to the shop from a cart with items', () => {
    seed([item])
    mount()

    const back = screen.getByRole('link', { name: /continue shopping/i })
    expect(back.getAttribute('href')).toBe('/search?tab=shop')
  })

  // On a phone the shell's desktop sidebar squeezed the cart into a sliver: the phone gets the cart and the bottom navigation.
  it('on a phone renders without the desktop shell, with the bottom navigation and finger-sized controls', () => {
    viewport.isMobile = true
    seed([item])
    mount()

    expect(screen.queryByTestId('app-shell')).toBeNull()
    expect(screen.getByTestId('bottom-nav')).toBeTruthy()
    expect(screen.getByText(/Shopping Cart/)).toBeTruthy()
    for (const name of [/decrease quantity of paracetamol/i, /increase quantity of paracetamol/i]) {
      const button = screen.getByRole('button', { name })
      expect(button.style.width).toBe('44px')
      expect(button.style.height).toBe('44px')
    }
    expect(screen.getByRole('button', { name: /remove paracetamol/i }).style.minHeight).toBe('44px')
  })
})
