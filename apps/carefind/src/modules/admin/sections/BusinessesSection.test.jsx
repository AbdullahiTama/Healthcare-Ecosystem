import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, within, act } from '@testing-library/react'
import { renderWithQueryClient } from '../../../test/renderWithQueryClient.jsx'

// The directory hook records every set of params it is called with and returns
// whatever query-like result the test has set.
const dir = vi.hoisted(() => ({ calls: [], result: null }))
const repo = vi.hoisted(() => ({ reviews: vi.fn(), products: vi.fn() }))
const csv = vi.hoisted(() => ({ exportCSV: vi.fn() }))

vi.mock('../hooks/useBusinessesDirectory', async (importActual) => {
  const actual = await importActual()
  return { ...actual, useBusinessesDirectory: (params) => { dir.calls.push(params); return dir.result } }
})
vi.mock('../repositories/feedConfigRepository', () => ({
  feedConfigRepository: { getBusinessReviews: repo.reviews, getBusinessProducts: repo.products },
}))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => ({ confirming: false }) }))
vi.mock('../ui', async (importActual) => ({ ...(await importActual()), exportCSV: csv.exportCSV }))

import BusinessesSection from './BusinessesSection.jsx'

const day = 86400000
const businesses = [
  { id: 'b1', name: 'Alpha Pharmacy', business_type: 'pharmacy', city: 'Ikeja', state: 'Lagos', whatsapp: '08030000000', visible_on_carefind: true, created_at: new Date(Date.now() - 3 * day).toISOString() },
  { id: 'b2', name: 'Beta Clinic', business_type: 'clinic', city: null, state: 'Kano', whatsapp: null, visible_on_carefind: false, created_at: new Date(Date.now() - 5 * day).toISOString() },
  { id: 'b3', name: '', business_type: 'dental', city: 'Jos', state: null, whatsapp: null, visible_on_carefind: false, created_at: new Date(Date.now() - 9 * day).toISOString() },
]
const reviewsB1 = [
  { id: 'r1', rating: 5, comment: 'Excellent service' },
  { id: 'r2', rating: 4, comment: 'Quick and friendly' },
  { id: 'r3', rating: 4, comment: null },
]
const productsB1 = [{ id: 'p1', name: 'Paracetamol', price: 500 }, { id: 'p2', name: 'Vitamin C', price: 900 }]
const reviewsB2 = [{ id: 'r9', rating: 2, comment: 'Beta only comment' }]
const productsB2 = [{ id: 'p9', name: 'Beta only product', price: 100 }]

const ok = (over = {}) => ({
  data: { rows: businesses, hasNext: true, total: 312 },
  isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn(), ...over,
})
const last = () => dir.calls[dir.calls.length - 1]
const render = () => renderWithQueryClient(<BusinessesSection />)
const openBusiness = (name) => {
  fireEvent.click(screen.getByRole('button', { name: `Review ${name}` }))
  return screen.getByRole('dialog')
}
// The value shown under a StatCard label.
const stat = (dialog, label) => within(dialog).getByText(label).parentElement.nextElementSibling
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const byBusiness = (map) => (id) => Promise.resolve(map[id])
const NONE = { search: '', type: 'all', status: 'all', location: '', page: 0 }

beforeEach(() => {
  dir.calls = []
  dir.result = ok()
  repo.reviews.mockReset().mockImplementation(byBusiness({ b1: reviewsB1, b2: reviewsB2, b3: [] }))
  repo.products.mockReset().mockImplementation(byBusiness({ b1: productsB1, b2: productsB2, b3: [] }))
  csv.exportCSV.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('BusinessesSection', () => {
  it('has one h1, renders rows with Claimed/Unclaimed text, and counts from total', () => {
    render()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Businesses' })).toBeInTheDocument()
    expect(screen.getByText('Alpha Pharmacy')).toBeInTheDocument()
    expect(screen.getByText('Beta Clinic')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Alpha Pharmacy/ })).getByText('Claimed')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Beta Clinic/ })).getByText('Unclaimed')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Alpha Pharmacy/ })).getByText('Pharmacy')).toBeInTheDocument()
    expect(screen.getByText('312 businesses')).toBeInTheDocument()
    expect(last()).toEqual(NONE)
  })

  it('shows the location without a stray comma when the city or state is missing', () => {
    render()
    expect(screen.getByText('Ikeja, Lagos')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Beta Clinic/ })).getByText('Kano')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Unnamed business/ })).getByText('Jos')).toBeInTheDocument()
  })

  it('search and location are debounced 300 ms, and every filter change returns to page 0', () => {
    vi.useFakeTimers()
    render()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search company name…' }), { target: { value: 'alpha' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(last().search).toBe('')
    act(() => { vi.advanceTimersByTime(1) })
    expect(last()).toEqual({ ...NONE, search: 'alpha' })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clinic' }))
    expect(last()).toEqual({ ...NONE, search: 'alpha', type: 'clinic' })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Unclaimed' }))
    expect(last()).toEqual({ ...NONE, search: 'alpha', type: 'clinic', status: 'unclaimed' })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    fireEvent.change(screen.getByLabelText('State or city'), { target: { value: ' Lagos ' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(last().location).toBe('')
    act(() => { vi.advanceTimersByTime(1) })
    expect(last()).toEqual({ search: 'alpha', type: 'clinic', status: 'unclaimed', location: 'Lagos', page: 0 })
  })

  it('offers all eight types and the three statuses as labelled pill groups, and the Claimed pill filters', () => {
    render()
    const types = screen.getByRole('group', { name: 'Business type' })
    const statuses = screen.getByRole('group', { name: 'Claim status' })
    for (const label of ['All', 'Pharmacy', 'Hospital', 'Clinic', 'Dental', 'Optical', 'Wellness', 'Skincare']) {
      expect(within(types).getByRole('button', { name: label })).toBeInTheDocument()
    }
    for (const label of ['All', 'Claimed', 'Unclaimed']) {
      expect(within(statuses).getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(within(statuses).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(statuses).getByRole('button', { name: 'Claimed' }))
    expect(last()).toEqual({ ...NONE, status: 'claimed' })
    expect(within(statuses).getByRole('button', { name: 'Claimed' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(statuses).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(types).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a whitespace-only location sends no location', () => {
    vi.useFakeTimers()
    render()
    fireEvent.change(screen.getByLabelText('State or city'), { target: { value: '   ' } })
    act(() => { vi.advanceTimersByTime(400) })
    expect(last().location).toBe('')
  })

  it('retyping the cleared location straight after Clear filters still applies it', () => {
    vi.useFakeTimers()
    dir.result = ok({ data: { rows: [], hasNext: false, total: null } })
    render()
    fireEvent.change(screen.getByLabelText('State or city'), { target: { value: 'Kano' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(last().location).toBe('Kano')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(last().location).toBe('')
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.change(screen.getByLabelText('State or city'), { target: { value: 'Kano' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(last().location).toBe('Kano')
  })

  it('a failed list shows Retry and never "No businesses match"', () => {
    dir.result = ok({ isError: true, data: undefined })
    render()
    expect(screen.queryByText(/No businesses match/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No businesses yet/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(dir.result.refetch).toHaveBeenCalled()
  })

  it('empty with filters says no businesses match and Clear filters resets every filter; empty without says "No businesses yet"', () => {
    vi.useFakeTimers()
    dir.result = ok({ data: { rows: [], hasNext: false, total: 0 } })
    const { unmount } = render()
    expect(screen.getByText('No businesses yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    unmount()

    render()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search company name…' }), { target: { value: 'zed' } })
    fireEvent.change(screen.getByLabelText('State or city'), { target: { value: 'Kano' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.click(screen.getByRole('button', { name: 'Clinic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Claimed' }))
    expect(last()).toEqual({ search: 'zed', type: 'clinic', status: 'claimed', location: 'Kano', page: 0 })
    expect(screen.getByText('No businesses match these filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    act(() => { vi.advanceTimersByTime(400) })
    expect(last()).toEqual(NONE)
    expect(screen.getByLabelText('State or city')).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Search company name…' })).toHaveValue('')
  })

  it('exports this page as CSV with its icon, and is disabled with no rows', () => {
    const { unmount } = render()
    const btn = screen.getByRole('button', { name: 'Export this page (CSV)' })
    expect(btn).toBeEnabled()
    expect(btn.querySelector('svg')).not.toBeNull()
    fireEvent.click(btn)
    expect(csv.exportCSV).toHaveBeenCalledWith(businesses, 'businesses_page.csv')
    unmount()

    dir.result = ok({ data: { rows: [], hasNext: false, total: 0 } })
    render()
    expect(screen.getByRole('button', { name: 'Export this page (CSV)' })).toBeDisabled()
  })

  it('the drawer shows details, counts, a one-decimal average and the reviews with accessible stars', async () => {
    render()
    const dialog = openBusiness('Alpha Pharmacy')
    expect(within(dialog).getByText('Alpha Pharmacy')).toBeInTheDocument()
    expect(within(dialog).getByText('Pharmacy')).toBeInTheDocument()
    expect(within(dialog).getByText('Ikeja, Lagos')).toBeInTheDocument()
    expect(within(dialog).getByText('08030000000')).toBeInTheDocument()
    expect(within(dialog).getByText('Claimed')).toBeInTheDocument()
    expect(repo.reviews).toHaveBeenCalledWith('b1')
    expect(repo.products).toHaveBeenCalledWith('b1')

    expect(await within(dialog).findByText('Excellent service')).toBeInTheDocument()
    expect(within(dialog).getByText('Quick and friendly')).toBeInTheDocument()
    expect(stat(dialog, 'Reviews')).toHaveTextContent('3')
    expect(stat(dialog, 'Products')).toHaveTextContent('2')
    expect(stat(dialog, 'Avg rating')).toHaveTextContent('4.3')
    expect(within(dialog).getByRole('img', { name: '5 out of 5' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('img', { name: '4 out of 5' })).toHaveLength(2)
  })

  it('omits WhatsApp when not set, and with no reviews shows "No reviews yet" and an average of N/A', async () => {
    render()
    const dialog = openBusiness('Unnamed business')
    expect(within(dialog).queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(await within(dialog).findByText('No reviews yet')).toBeInTheDocument()
    expect(stat(dialog, 'Avg rating')).toHaveTextContent('N/A')
    expect(stat(dialog, 'Reviews')).toHaveTextContent('0')
    expect(stat(dialog, 'Products')).toHaveTextContent('0')
  })

  it('while the stats load they show "…", not 0', () => {
    repo.reviews.mockReturnValue(new Promise(() => {}))
    repo.products.mockReturnValue(new Promise(() => {}))
    render()
    const dialog = openBusiness('Alpha Pharmacy')
    expect(stat(dialog, 'Reviews')).toHaveTextContent('…')
    expect(stat(dialog, 'Products')).toHaveTextContent('…')
    expect(stat(dialog, 'Avg rating')).toHaveTextContent('…')
    expect(within(dialog).queryByText('No reviews yet')).not.toBeInTheDocument()
  })

  it('a failed products load shows "Couldn\'t load" on the Products card, never 0, while reviews still render', async () => {
    repo.products.mockRejectedValue(new Error('boom'))
    render()
    const dialog = openBusiness('Alpha Pharmacy')
    expect(await within(dialog).findByText('Excellent service')).toBeInTheDocument()
    expect(await within(dialog).findByText("Couldn't load")).toBeInTheDocument()
    expect(stat(dialog, 'Products')).toHaveTextContent("Couldn't load")
    expect(stat(dialog, 'Products')).not.toHaveTextContent('0')
    expect(stat(dialog, 'Reviews')).toHaveTextContent('3')
    expect(stat(dialog, 'Avg rating')).toHaveTextContent('4.3')
  })

  it('a failed reviews load says "Couldn\'t load reviews", never "No reviews yet" or a 0 count or an average', async () => {
    repo.reviews.mockRejectedValue(new Error('boom'))
    render()
    const dialog = openBusiness('Alpha Pharmacy')
    expect(await within(dialog).findByText("Couldn't load reviews")).toBeInTheDocument()
    expect(within(dialog).queryByText('No reviews yet')).not.toBeInTheDocument()
    expect(stat(dialog, 'Reviews')).toHaveTextContent("Couldn't load")
    expect(stat(dialog, 'Avg rating')).toHaveTextContent("Couldn't load")
    expect(stat(dialog, 'Avg rating')).not.toHaveTextContent('N/A')
    expect(stat(dialog, 'Products')).toHaveTextContent('2')
  })

  it('Export company data stays disabled until both loads succeed, then exports reviews and products by name', async () => {
    const reviews = deferred()
    const products = deferred()
    repo.reviews.mockReturnValue(reviews.promise)
    repo.products.mockReturnValue(products.promise)
    render()
    const dialog = openBusiness('Alpha Pharmacy')
    const btn = within(dialog).getByRole('button', { name: 'Export company data CSV' })
    expect(btn).toBeDisabled()

    await act(async () => { reviews.resolve(reviewsB1) })
    expect(btn).toBeDisabled()

    await act(async () => { products.resolve(productsB1) })
    expect(btn).toBeEnabled()
    expect(btn.querySelector('svg')).not.toBeNull()
    fireEvent.click(btn)
    expect(csv.exportCSV).toHaveBeenCalledWith([...reviewsB1, ...productsB1], 'Alpha Pharmacy_data.csv')
  })

  it('Export company data stays disabled when either load failed', async () => {
    repo.products.mockRejectedValue(new Error('boom'))
    render()
    const dialog = openBusiness('Alpha Pharmacy')
    await within(dialog).findByText("Couldn't load")
    expect(within(dialog).getByRole('button', { name: 'Export company data CSV' })).toBeDisabled()
  })

  it('has no footer actions in the drawer', async () => {
    render()
    const dialog = openBusiness('Alpha Pharmacy')
    await within(dialog).findByText('Excellent service')
    expect(within(dialog).queryByRole('button', { name: /^(verify|suspend|delete|remove|claim|approve)/i })).not.toBeInTheDocument()
  })

  it('opening a second business shows its own data, never the first one\'s', async () => {
    const reviews2 = deferred()
    repo.reviews.mockImplementation((id) => (id === 'b2' ? reviews2.promise : Promise.resolve(reviewsB1)))
    render()
    let dialog = openBusiness('Alpha Pharmacy')
    expect(await within(dialog).findByText('Excellent service')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    dialog = openBusiness('Beta Clinic')
    expect(within(dialog).queryByText('Excellent service')).not.toBeInTheDocument()
    expect(stat(dialog, 'Reviews')).toHaveTextContent('…')
    expect(stat(dialog, 'Products')).not.toHaveTextContent('2')
    expect(repo.reviews).toHaveBeenLastCalledWith('b2')

    await act(async () => { reviews2.resolve(reviewsB2) })
    expect(await within(dialog).findByText('Beta only comment')).toBeInTheDocument()
    expect(within(dialog).queryByText('Excellent service')).not.toBeInTheDocument()
    expect(stat(dialog, 'Reviews')).toHaveTextContent('1')
    expect(stat(dialog, 'Products')).toHaveTextContent('1')
    expect(stat(dialog, 'Avg rating')).toHaveTextContent('2.0')
  })
})
