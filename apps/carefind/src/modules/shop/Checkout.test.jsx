// Checkout must survive the cart arriving after its first render (the cart is read from storage in an effect, so a refresh of
// /checkout renders once with an empty cart): returning early before a hook crashed the page with "Rendered more hooks than
// during the previous render". On a phone it must be one column with the items listed in the summary.
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const viewport = vi.hoisted(() => ({ isMobile: false }))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: viewport.isMobile, isTablet: false }) }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'ada@example.com', user_metadata: { full_name: 'Ada' } } }) }))
vi.mock('../account/addressesRepository', () => ({ addressesRepository: { getByUser: async () => [], list: async () => [], create: async () => ({}) } }))
vi.mock('./shopRepository', () => ({ shopRepository: {
  getPickupStations: async () => [{ id: 'st1', name: 'Lekki Pickup Hub', address: '22 Admiralty Way', city: 'Lagos' }],
  validateStock: async () => [],
} }))

import Checkout from './Checkout'
import { CartProvider } from './CartProvider'

const seed = () => localStorage.setItem('carefind_cart', JSON.stringify([
  { ecommerce_product_id: 'e1', vendor_id: 'v1', product_name: 'Paracetamol 500mg', unit_price_kobo: 250000, quantity: 2 },
  { ecommerce_product_id: 'e2', vendor_id: 'v1', product_name: 'Vitamin C 1000mg', unit_price_kobo: 1230500, quantity: 1 },
]))

function mount() {
  return render(<MemoryRouter><CartProvider><Checkout /></CartProvider></MemoryRouter>)
}

describe('Checkout page', () => {
  beforeEach(() => { localStorage.clear(); viewport.isMobile = false })

  it('renders when the cart loads after the first render (a refresh of /checkout) instead of crashing', async () => {
    seed()
    mount()
    expect(await screen.findByText('Order Summary')).toBeTruthy()
  })

  it('lists every item in the summary, with plain fee labels (no pricing formula)', async () => {
    seed()
    mount()
    const list = await screen.findByRole('list', { name: /items in this order/i })
    expect(list.textContent).toContain('Paracetamol 500mg')
    expect(list.textContent).toContain('2 × ₦2,500')
    expect(list.textContent).toContain('Vitamin C 1000mg')
    expect(screen.getByText('Fulfilment fee')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/MAX\(/)
  })

  it('shows the empty state for an empty cart', async () => {
    mount()
    expect(await screen.findByText('Your cart is empty')).toBeTruthy()
  })

  it('on a phone puts paired fields in one column and shows the chosen station address', async () => {
    viewport.isMobile = true
    seed()
    mount()
    await screen.findByText('Order Summary')
    const grids = [...document.querySelectorAll('form div')].filter(d => d.style.display === 'grid')
    expect(grids.length).toBeGreaterThan(0)
    for (const g of grids) expect(g.style.gridTemplateColumns).toBe('1fr')
    expect(await screen.findByText(/22 Admiralty Way, Lagos/)).toBeTruthy()
  })

  it('does not call home delivery "quote pending" before an address is entered, and does once it is outside the zone', async () => {
    seed()
    mount()
    await screen.findByText('Order Summary')
    fireEvent.click(screen.getByLabelText(/home delivery/i))
    expect(screen.queryByText(/quotes delivery for your area/i)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Lagos'), { target: { value: 'Jalingo' } })
    fireEvent.change(screen.getByPlaceholderText('Lagos State'), { target: { value: 'Taraba' } })
    expect(screen.getByText(/quotes delivery for your area/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /get delivery quote/i })).toBeTruthy()
  })
})
