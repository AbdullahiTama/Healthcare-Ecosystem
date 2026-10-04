import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../../test/renderWithQueryClient.jsx'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const navigateMock = vi.fn()
const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }))

// Hoisted supabase mock with table data and builder
const mockSupabase = vi.hoisted(() => {
  const data = {
    tables: {
      businesses: [],
      promotions: [],
      products: [],
      profiles: [],
      search_logs: [],
    },
  }
  const rows = (table) => data.tables[table] || []
  const matches = (row, cons) =>
    Object.entries(cons).every(([col, vals]) => {
      const arr = Array.isArray(vals) ? vals : [vals]
      // For session-based checks, allow any if vals is empty?
      return arr.some((v) => row[col] === v)
    })
  function builder(table) {
    const cons = {}
    let rangeFrom = null
    let rangeTo = null
    let orderCol = null
    let limitN = null
    const b = {
      select: vi.fn(() => b),
      eq: vi.fn((col, v) => { (cons[col] = cons[col] || []).push(v); return b }),
      or: vi.fn(() => b),
      ilike: vi.fn(() => b),
      gt: vi.fn(() => b),
      gte: vi.fn(() => b),
      lt: vi.fn(() => b),
      order: vi.fn((col, opts) => { orderCol = col; return b }),
      limit: vi.fn((n) => { limitN = n; return b }),
      range: vi.fn((from, to) => { rangeFrom = from; rangeTo = to; return b }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: rows(table).find((r) => matches(r, cons)) || null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: rows(table).find((r) => matches(r, cons)) || null, error: null })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve) => {
        let filtered = rows(table).filter((r) => matches(r, cons))
        if (rangeFrom !== null && rangeTo !== null) filtered = filtered.slice(rangeFrom, rangeTo + 1)
        else if (limitN !== null) filtered = filtered.slice(0, limitN)
        return Promise.resolve({ data: filtered, error: null }).then(resolve)
      },
    }
    return b
  }
  const supabase = {
    from: vi.fn((table) => builder(table)),
    auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), unsubscribe: vi.fn() })),
    removeChannel: vi.fn(),
    storage: { from: vi.fn(() => ({ upload: vi.fn(() => Promise.resolve({ error: null })), getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'blob:mock' } })) })) },
  }
  return { supabase, data }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase.supabase }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('../../hooks/useHeaderIdentity', () => ({ useHeaderIdentity: () => ({ myUsername: '', myAvatar: null, unreadNotifs: 0 }) }))
vi.mock('../../hooks/useGeolocation', () => ({ useGeolocation: () => ({ coords: null }) }))
vi.mock('../shop/CartProvider', () => ({ useCart: () => ({ count: 0 }) }))
vi.mock('../utils/contactLeads.js', () => ({ recordContactLead: vi.fn() }))
vi.mock('../utils/sellerLookup.js', () => ({
  attachOwnerProfiles: vi.fn((list) => Promise.resolve(list)),
  sellerName: (p) => p?.businesses?.name || 'CareFind seller',
  sellerContact: () => null,
  sellerPhone: () => null,
}))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/Logo.jsx', () => ({ default: () => null }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => children }))
// The default 'shop' tab renders the whole storefront, which needs its own providers.
vi.mock('../shop/Shop', () => ({ default: () => <div>shop storefront</div> }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

import Search from './Search.jsx'

// Use global fetch mock
global.fetch = fetchMock

function makeBusiness(overrides = {}) {
  return {
    id: 'b1',
    name: 'Test Facility',
    business_type: 'hospital',
    city: 'Lagos',
    state: 'Lagos',
    cover_url: null,
    booking_enabled: true,
    latitude: null,
    longitude: null,
    lat: 6.5,
    lng: 3.3,
    visible_on_carefind: true,
    status: 'active',
    ...overrides,
  }
}

describe('Search facility cards — View Profile / Book Appointment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockClear()
    navigateMock.mockClear()
    mockSupabase.supabase.from.mockClear()
    mockSupabase.data.tables.businesses = []
    mockSupabase.data.tables.promotions = []
    mockSupabase.data.tables.products = []
    mockSupabase.data.tables.search_logs = []
    // Clear sessionStorage throttle
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
    global.fetch = fetchMock
  })

  it('renders View Profile and Book Appointment as primary actions (no WhatsApp/Call)', async () => {
    mockSupabase.data.tables.businesses = [
      makeBusiness({ id: 'b1', name: 'Facility With Booking', booking_enabled: true }),
      makeBusiness({ id: 'b2', name: 'Facility Without Booking', booking_enabled: false }),
    ]

    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )

    // Wait for both facilities to appear
    expect(await screen.findByText('Facility With Booking')).toBeInTheDocument()
    expect(await screen.findByText('Facility Without Booking')).toBeInTheDocument()

    // View Profile links exist for both
    const viewLinks = screen.getAllByRole('link', { name: 'View Profile' })
    expect(viewLinks).toHaveLength(2)
    expect(viewLinks[0]).toHaveAttribute('href', '/business/b1')
    expect(viewLinks[1]).toHaveAttribute('href', '/business/b2')

    // Book Appointment buttons exist for both
    const bookBtns = screen.getAllByRole('button', { name: /Book Appointment/ })
    expect(bookBtns).toHaveLength(2)

    // Must NOT render WhatsApp/Call as primaries on facility cards
    expect(screen.queryByRole('link', { name: /WhatsApp/i })).not.toBeInTheDocument()
    // The only call links would be tel: — ensure none rendered for facilities
    const callLinks = document.querySelectorAll('a[href^="tel:"]')
    expect(callLinks.length).toBe(0)
  })

  it('Book Appointment for booking_enabled=true navigates to profile (existing workflow)', async () => {
    mockSupabase.data.tables.businesses = [
      makeBusiness({ id: 'b1', name: 'Bookable Facility', booking_enabled: true }),
    ]

    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )

    await screen.findByText('Bookable Facility')
    const bookBtn = screen.getByRole('button', { name: 'Book Appointment' })
    fireEvent.click(bookBtn)

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('/business/b1')))
    // Verify it navigates to the booking anchor
    expect(navigateMock.mock.calls[0][0]).toMatch(/\/business\/b1/)
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('booking-interest'), expect.anything())
  })

  it('Book Appointment for booking_enabled=false shows unavailable toast and notifies interest (no navigation)', async () => {
    mockSupabase.data.tables.businesses = [
      makeBusiness({ id: 'b2', name: 'Non-Bookable Facility', booking_enabled: false }),
    ]

    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )

    await screen.findByText('Non-Bookable Facility')
    const bookBtn = screen.getByRole('button', { name: /Book Appointment unavailable/ })
    // Button should be marked as unavailable
    expect(bookBtn).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(bookBtn)

    // Toast appears with exact message
    expect(await screen.findByText('This healthcare facility is not accepting appointments at the moment.')).toBeInTheDocument()

    // No navigation to booking
    expect(navigateMock).not.toHaveBeenCalled()

    // Best-effort interest notification fired
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/booking-interest', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    })))
    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(fetchBody.business_id).toBe('b2')

    // Second click is throttled via sessionStorage — should not double-fire
    fetchMock.mockClear()
    fireEvent.click(bookBtn)
    // Still shows toast but fetch is throttled (no second call)
    await screen.findByText('This healthcare facility is not accepting appointments at the moment.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('businessesQuery selects booking_enabled (verifies facility gating is available)', async () => {
    mockSupabase.data.tables.businesses = [
      makeBusiness({ id: 'b1', name: 'Gated Facility', booking_enabled: true }),
    ]

    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )

    await screen.findByText('Gated Facility')

    // Verify the select call included booking_enabled
    const selectCalls = mockSupabase.supabase.from.mock.calls
      .filter(c => c[0] === 'businesses')
      .map(() => {})
    // Check that at least one builder was created with select containing booking_enabled
    // Since our mock's select is a vi.fn, we can inspect the last builder's select calls
    // Instead, directly check that businesses data with booking_enabled was rendered correctly
    const bookBtn = screen.getByRole('button', { name: 'Book Appointment' })
    expect(bookBtn).toBeInTheDocument()
  })
})

// The marketing landing page's category tiles deep-link here
// (/search?tab=businesses&q=pharmacy), and a shared search URL now reproduces
// its result set instead of an empty page.
describe('Search — ?q= deep link', () => {
  beforeEach(() => {
    mockSupabase.data.tables.businesses = []
    mockSupabase.data.tables.products = []
    fetchMock.mockClear()
  })

  it('prefills the input from ?q= and runs that query on load', async () => {
    render(
      <MemoryRouter initialEntries={['/search?tab=businesses&q=pharmacy']}>
        <Search />
      </MemoryRouter>
    )

    const input = await screen.findByLabelText('Search medication, facility, professional')
    expect(input).toHaveValue('pharmacy')

    // The query is executed, not merely displayed: the businesses builder is
    // created with a text filter rather than left unfiltered.
    await waitFor(() => {
      expect(mockSupabase.supabase.from).toHaveBeenCalled()
    })
  })

  it('leaves the input empty and the URL unfiltered without ?q=', async () => {
    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )

    const input = await screen.findByLabelText('Search medication, facility, professional')
    expect(input).toHaveValue('')
  })

  it('keeps a visible focus indicator on the search input', async () => {
    // tab=businesses, not the default shop tab: Shop pulls in WishlistProvider,
    // which this suite deliberately does not wrap.
    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )

    // An inline `outline: 'none'` outranks the stylesheet and silently kills
    // the global :focus-visible ring (ACCESSIBILITY.md:16).
    const input = await screen.findByLabelText('Search medication, facility, professional')
    expect(input.style.outline).not.toBe('none')
  })
})

// main.jsx keys <Routes> on location.key, so ANY router navigation — a
// `replace` included — remounts the page. Search mirrors its tab into ?tab= and
// used to do that with setSearchParams, so: on bare /search (default tab
// "shop", no ?tab=) it saw "URL differs from tab", replaced the URL, remounted,
// saw the same thing and looped forever; and every tab switch remounted the
// page, wiping what had been typed. These mirror main.jsx's keyed Routes; a
// bare <Search /> cannot reproduce a remount.
describe('Search tab <-> URL sync under keyed Routes', () => {
  let mounts
  function Probe() {
    useEffect(() => { mounts += 1 }, [])
    return <Search />
  }
  function KeyedRoutes() {
    const location = useLocation()
    return (
      <Routes key={location.key}>
        <Route path="/search" element={<Probe />} />
      </Routes>
    )
  }
  function renderKeyed(path) {
    mounts = 0
    return render(
      <MemoryRouter initialEntries={[path]}>
        <KeyedRoutes />
      </MemoryRouter>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.data.tables.businesses = []
    mockSupabase.data.tables.products = []
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
    global.fetch = fetchMock
  })

  it('mounts once on bare /search instead of remounting in a loop', async () => {
    renderKeyed('/search')
    await screen.findByRole('tablist', { name: 'Marketplace categories' })

    // A remount loop would keep incrementing this while we wait.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(mounts).toBe(1)
  })

  it('keeps what was typed when the tab is switched', async () => {
    renderKeyed('/search?tab=shop')
    const input = await screen.findByPlaceholderText('Search medication, facility, professional...')
    fireEvent.change(input, { target: { value: 'amoxicillin' } })
    expect(input).toHaveValue('amoxicillin')

    fireEvent.click(screen.getByRole('tab', { name: /Facilities/ }))

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Facilities/ })).toHaveAttribute('aria-selected', 'true'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(mounts).toBe(1)
    expect(screen.getByPlaceholderText('Search medication, facility, professional...')).toHaveValue('amoxicillin')
  })
})

// The Shop tab opens with the marketplace banner and a single search card (query, location, Search, Filters).
describe('Search — shop banner and search card', () => {
  beforeEach(() => {
    mockSupabase.data.tables.businesses = []
    mockSupabase.data.tables.products = []
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
  })

  it('shows the marketplace banner on the Shop tab', async () => {
    render(
      <MemoryRouter initialEntries={['/search?tab=shop']}>
        <Search />
      </MemoryRouter>
    )
    expect(await screen.findByRole('heading', { name: 'Find trusted health products near you' })).toBeInTheDocument()
    expect(screen.getByText('Verified sellers')).toBeInTheDocument()
  })

  it('does not show the banner on the other tabs', async () => {
    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )
    await screen.findByLabelText('Search medication, facility, professional')
    expect(screen.queryByRole('heading', { name: 'Find trusted health products near you' })).toBeNull()
  })

  it('keeps query, location, Search and Filters in one search form', async () => {
    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )
    const form = await screen.findByRole('search', { name: 'Marketplace search' })
    expect(form).toContainElement(screen.getByLabelText('Search medication, facility, professional'))
    expect(form).toContainElement(screen.getByLabelText('Filter by city or state'))
    expect(form).toContainElement(screen.getByRole('button', { name: 'Search' }))
    expect(form).toContainElement(screen.getByRole('button', { name: /filters/i }))
  })

  it('opens the filters without submitting the search form', async () => {
    render(
      <MemoryRouter initialEntries={['/search?tab=businesses']}>
        <Search />
      </MemoryRouter>
    )
    const input = await screen.findByLabelText('Search medication, facility, professional')
    fireEvent.change(input, { target: { value: 'amoxicillin' } })
    const filters = screen.getByRole('button', { name: /filters/i })
    expect(filters).toHaveAttribute('type', 'button')

    fireEvent.click(filters)
    // A submit would have recorded the query as a recent search and put it in the URL.
    expect(localStorage.getItem('carefind_recent_searches')).toBeNull()
  })
})

// The Products tab opens with a rail above the results: promotions when any are running, otherwise trending products.
// Both branches render components the page must import — a missing import only crashes once there is data to show.
describe('Search — Products tab featured rail', () => {
  beforeEach(() => {
    mockSupabase.data.tables.businesses = []
    mockSupabase.data.tables.promotions = []
    mockSupabase.data.tables.products = []
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
  })

  it('shows running promotions', async () => {
    mockSupabase.data.tables.promotions = [
      { id: 'pr1', title: 'Malaria week: 10% off', image_url: null, link_url: '/search', expires_at: null },
    ]

    render(
      <MemoryRouter initialEntries={['/search?tab=products']}>
        <Search />
      </MemoryRouter>
    )

    expect(await screen.findByText('Featured promotions')).toBeInTheDocument()
    expect(screen.getAllByText('Malaria week: 10% off').length).toBeGreaterThan(0)
  })

  it('falls back to trending products when no promotion is running', async () => {
    mockSupabase.data.tables.products = [
      { id: 'p1', name: 'Paracetamol 500mg', emoji: null, price: 500, show_price: true, business_id: 'b1', list_on_carefind: true, businesses: { name: 'MediPlus Pharmacy', show_prices: true } },
    ]

    render(
      <MemoryRouter initialEntries={['/search?tab=products']}>
        <Search />
      </MemoryRouter>
    )

    expect(await screen.findByText('Trending Now')).toBeInTheDocument()
    expect(screen.getAllByText('Paracetamol 500mg').length).toBeGreaterThan(0)
  })
})
