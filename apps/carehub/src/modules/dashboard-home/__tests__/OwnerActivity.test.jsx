import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The Owner's "Business activity" on the dashboard: money records staff entered,
// who entered them and when, each opening the record; plus what still needs
// paying or chasing. Routine sales stay out.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repos = vi.hoisted(() => ({ feed: vi.fn(), balances: vi.fn(), debts: vi.fn() }))
vi.mock('../../staff/repositories', () => ({ staffActivityRepository: { get: repos.feed } }))
vi.mock('../../purchases/repositories', () => ({ purchaseRepository: { getSupplierBalances: repos.balances } }))
vi.mock('../../debts/repositories', () => ({ debtRepository: { getOpen: repos.debts } }))

import OwnerActivity from '../OwnerActivity.jsx'
import { fmt } from '../../../lib/utils'

const BRAND = { id: 'biz-1' }
const now = Date.now()
const ago = (min) => new Date(now - min * 60000).toISOString()
const FEED = [
  { kind: 'sale', ref: 'T1', amount: 500, summary: 'T1 · Walk-in · Cash', actor_name: 'Rep One', occurred_at: ago(5) },
  { kind: 'purchase', ref: 'p-1', amount: 50000, summary: 'Emzor · Paracetamol · ₦30,000 unpaid', actor_name: 'Rep One', actor_role: 'Cashier', occurred_at: ago(10) },
  { kind: 'expense', ref: 'e-1', amount: 2500, summary: 'Transport · Fuel', actor_name: 'Rep Two', actor_role: 'Pharmacist', occurred_at: ago(20) },
  { kind: 'credit_sale', ref: 'T9', amount: 3000, summary: 'T9 · Bola · Credit · ₦2,000 still owed', actor_name: 'Rep One', occurred_at: ago(30) },
  { kind: 'refund', ref: 'T1', amount: 100, summary: 'T1 · Cash · damaged', actor_name: 'Ada Owner', occurred_at: ago(40) },
]

let root, host, onOpenSale
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
function Loc() { return <div data-testid='loc'>{useLocation().pathname + useLocation().search}</div> }
async function mount() {
  onOpenSale = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><OwnerActivity brand={BRAND} onOpenSale={onOpenSale} /><Loc /></MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await flush(); await flush()
}
const text = () => host.textContent
const button = (t) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(t))
const loc = () => host.querySelector('[data-testid="loc"]').textContent

beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  localStorage.clear()
  repos.feed.mockResolvedValue(FEED)
  repos.balances.mockResolvedValue([{ supplier_name: 'Emzor', balance: 30000 }])
  repos.debts.mockResolvedValue([{ direction: 'we_owe', party_name: 'Landlord', balance: 120000, due_date: '2026-01-01', status: 'pending', source: 'manual' }])
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

describe('OwnerActivity', () => {
  it('lists money records with what, who, when and how much, and leaves routine sales out', async () => {
    await mount()
    expect(text()).toContain('Business activity')
    expect(text()).toContain('Purchase · Emzor · Paracetamol · ₦30,000 unpaid')
    expect(text()).toContain('Rep One (Cashier) · Today')
    expect(text()).toContain(fmt(50000))
    expect(text()).toContain('Expense · Transport · Fuel')
    expect(text()).toContain('Credit sale · T9 · Bola')
    expect(text()).toContain('Refund · T1')
    expect(text()).not.toContain('Sale · T1 · Walk-in')
    // It asks the Owner-only feed for the last seven business days.
    const [bid, from, to, limit] = repos.feed.mock.calls[0]
    expect(bid).toBe('biz-1')
    expect((new Date(to) - new Date(from)) / 864e5).toBe(7)
    expect(limit).toBe(500)
  })

  it('highlights what still needs paying', async () => {
    await mount()
    const group = host.querySelector('[role="group"][aria-label="Needs follow-up"]')
    expect(group.textContent).toContain('Owed to suppliers')
    expect(group.textContent).toContain(fmt(30000))
    expect(group.textContent).toContain('Bills past due')
    expect(group.textContent).toContain('Landlord')
    await act(async () => { button('Owed to suppliers').click() })
    expect(loc()).toBe('/dashboard/purchases?view=suppliers')
  })

  it('filters by kind, with counts on the tabs', async () => {
    await mount()
    const tab = button('Purchases & suppliers (1)')
    expect(tab.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { tab.click() })
    expect(tab.getAttribute('aria-pressed')).toBe('true')
    expect(text()).toContain('Purchase · Emzor')
    expect(text()).not.toContain('Expense · Transport')
  })

  it('opens each record: a purchase on its screen, a sale in full', async () => {
    await mount()
    await act(async () => { button('Credit sale · T9').click() })
    expect(onOpenSale).toHaveBeenCalledWith('T9')
    await act(async () => { button('Purchase · Emzor').click() })
    expect(loc()).toBe('/dashboard/purchases?purchase=p-1')
  })

  it('marks what arrived since the last visit as new', async () => {
    localStorage.setItem('carehub_owner_activity_seen_biz-1', ago(25))
    await mount()
    expect(text()).toContain('2 new')
    expect(button('Purchase · Emzor').textContent).toContain('New')
    expect(button('Credit sale · T9').textContent).not.toContain('New')
    // This visit is remembered for next time.
    expect(new Date(localStorage.getItem('carehub_owner_activity_seen_biz-1')).getTime()).toBeGreaterThan(now - 1000)
  })

  it('has an empty state, and an error state with a retry', async () => {
    repos.feed.mockResolvedValue([FEED[0]])
    repos.balances.mockResolvedValue([])
    repos.debts.mockResolvedValue([])
    await mount()
    expect(text()).toContain('No purchases, expenses, credit, refunds or changes recorded in the last 7 days.')
    expect(text()).toContain('No supplier balances or overdue debts to follow up.')
    await act(async () => { root.unmount() })
    root = createRoot(host)
    repos.feed.mockRejectedValue(new Error('Supabase error (400): boom'))
    await mount()
    expect(text()).toContain('Business activity could not be loaded.')
    expect(button('Retry')).toBeTruthy()
  })
})
