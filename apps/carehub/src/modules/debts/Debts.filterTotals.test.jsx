// Filtering debts by a customer's name shows what that customer owes in total.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const debts = vi.hoisted(() => ({ getAll: vi.fn(), getForBusinesses: vi.fn(), update: vi.fn(), create: vi.fn() }))
vi.mock('./repositories', () => ({ debtRepository: debts }))
const locs = vi.hoisted(() => ({ getAll: vi.fn() }))
vi.mock('../locations/repositories', () => ({ locationsRepository: locs }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(async () => []), sbFetchWithCount: vi.fn() }))

import Debts from './Debts.jsx'

const ROWS = [
  { id: 'd1', party_name: 'Bola Ade', direction: 'owes_us', amount: 5000, amount_paid: 2000, balance: 3000, status: 'pending', source: 'credit_sale', source_ref: 'TXN-1', created_at: '2026-10-21' },
  { id: 'd2', party_name: 'bola ade', direction: 'owes_us', amount: 1500, amount_paid: 0, balance: 1500, status: 'pending', source: 'manual', created_at: '2026-09-02' },
  { id: 'd3', party_name: 'Bola Ade', direction: 'owes_us', amount: 800, amount_paid: 800, balance: 0, status: 'paid', source: 'manual', created_at: '2026-10-05' },
  { id: 'd4', party_name: 'Chidi', direction: 'owes_us', amount: 700, amount_paid: 0, balance: 700, status: 'pending', source: 'manual', created_at: '2026-10-19' },
  { id: 'd5', party_name: 'Emzor Ltd', direction: 'we_owe', amount: 9000, amount_paid: 0, balance: 9000, status: 'pending', source: 'manual', created_at: '2026-10-20' },
]

let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const summary = () => host.querySelector('[role="status"][aria-live="polite"]')
const card = (title) => [...host.querySelectorAll('div')].find((d) => d.firstChild?.textContent === title && d.children.length >= 2)
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text))
async function openFilters() { await act(async () => { button('Debt filters').click() }); await flush() }
async function choose(label, value) {
  const id = [...host.querySelectorAll('label')].find((l) => l.textContent.trim() === label).htmlFor
  const el = document.getElementById(id)
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
  await flush()
}
async function setInput(el, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await flush()
}
async function type(label, value) {
  const el = host.querySelector(`input[aria-label="${label}"]`)
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await flush()
}

beforeEach(async () => {
  vi.clearAllMocks()
  locs.getAll.mockResolvedValue([{ id: 'b', name: 'Main' }])
  debts.getAll.mockResolvedValue(ROWS)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Debts brand={{ id: 'b' }} role='Owner' perms={{}} /></QueryClientProvider>) })
  await flush()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear() })

describe('Debts: totals for a filter', () => {
  it('shows no filter summary until a search or month is chosen', () => {
    expect(summary()).toBeNull()
  })

  it('searching a customer shows the total they owe across all their debts (any capitalisation)', async () => {
    await type('Search debts by customer or party name', '  bola ')
    expect(summary().textContent).toContain('3 debts for "bola"')
    expect(summary().textContent).toContain('Outstanding, owed to you: ₦4,500')
    expect(summary().textContent).toContain('(2 open)')
    expect(summary().textContent).not.toContain('You owe')
  })

  it('a supplier search shows what the business owes them', async () => {
    await type('Search debts by customer or party name', 'emzor')
    expect(summary().textContent).toContain('Outstanding, owed to you: ₦0')
    expect(summary().textContent).toContain('You owe: ₦9,000')
  })

  it('search and month together total only the matching rows', async () => {
    await type('Search debts by customer or party name', 'bola')
    await openFilters()
    await choose('Date recorded', 'month')
    await setInput(host.querySelector('input[type="month"]'), '2026-10')
    expect(summary().textContent).toContain('2 debts for "bola" · Oct 2026')
    expect(summary().textContent).toContain('₦3,000')
  })

  it('the cards always total what is shown: a payment-status filter recalculates them', async () => {
    expect(card('Total outstanding').textContent).toContain('₦14,200')
    expect(card('Owed to us').textContent).toContain('₦5,200')
    expect(card('We owe others').textContent).toContain('₦9,000')
    await openFilters()
    await choose('Payment status', 'partial')
    expect(card('Total outstanding').textContent).toContain('₦3,000')
    expect(card('We owe others').textContent).toContain('₦0')
    expect(summary().textContent).toContain('1 debt for Partially paid')
    expect(summary().textContent).toContain('0 unpaid · 1 partially paid · 0 paid')
  })

  it('direction and amount range narrow the list and the totals together', async () => {
    await openFilters()
    await choose('Direction', 'owes_us')
    const [min] = host.querySelectorAll('input[type="number"]')
    await setInput(min, '1000')
    expect(card('Owed to us').textContent).toContain('₦4,500')
    expect(summary().textContent).toContain('Owed to us · outstanding at least ₦1,000')
  })

  it('no matches: says so and offers to clear the filters', async () => {
    await type('Search debts by customer or party name', 'nobody')
    expect(host.textContent).toContain('No debts match "nobody"')
    expect(summary().textContent).toContain('0 debts')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear filters').click() })
    await flush()
    expect(summary()).toBeNull()
  })
})

describe('Debts: locations (owner with branches)', () => {
  const MULTI = [
    { ...ROWS[0], business_id: 'b' },
    { id: 'x1', business_id: 'br2', party_name: 'Ikeja customer', direction: 'owes_us', amount: 2000, amount_paid: 0, balance: 2000, status: 'pending', source: 'manual', created_at: '2026-10-22' },
  ]
  beforeEach(async () => {
    await act(async () => root.unmount())
    vi.clearAllMocks()
    locs.getAll.mockResolvedValue([{ id: 'b', name: 'Main' }, { id: 'br2', name: 'Pharm', branch_name: 'Ikeja' }])
    debts.getForBusinesses.mockResolvedValue(MULTI)
    root = createRoot(host)
    await act(async () => { root.render(<QueryClientProvider client={qc}><Debts brand={{ id: 'b' }} role='Owner' perms={{}} /></QueryClientProvider>) })
    await flush()
  })

  it('loads every location but shows the one in use by default', async () => {
    expect(debts.getForBusinesses).toHaveBeenCalledWith(['b', 'br2'])
    expect(host.textContent).not.toContain('Ikeja customer')
    expect(card('Owed to us').textContent).toContain('₦3,000')
    expect(summary()).toBeNull()
  })

  it('"All locations" totals both, and a branch\'s debt is settled at that branch', async () => {
    await openFilters()
    await choose('Location', '')
    expect(card('Owed to us').textContent).toContain('₦5,000')
    expect(host.textContent).toContain('Ikeja customer')
    expect(host.textContent).toContain('Settle at Ikeja')
    expect(summary().textContent).toContain('all locations')
  })

  it('staff never list locations; they see their own business only', async () => {
    await act(async () => root.unmount())
    vi.clearAllMocks()
    debts.getAll.mockResolvedValue(ROWS)
    root = createRoot(host)
    await act(async () => { root.render(<QueryClientProvider client={qc}><Debts brand={{ id: 'b' }} role='Cashier' perms={{}} /></QueryClientProvider>) })
    await flush()
    expect(locs.getAll).not.toHaveBeenCalled()
    expect(debts.getAll).toHaveBeenCalledWith('b')
  })
})
