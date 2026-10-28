// Filtering debts by a customer's name shows what that customer owes in total.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const debts = vi.hoisted(() => ({ getAll: vi.fn(), update: vi.fn(), create: vi.fn() }))
vi.mock('./repositories', () => ({ debtRepository: debts }))
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
async function type(label, value) {
  const el = host.querySelector(`input[aria-label="${label}"]`)
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await flush()
}

beforeEach(async () => {
  vi.clearAllMocks()
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
    await type('Filter debts by month', '2026-10')
    expect(summary().textContent).toContain('2 debts for "bola" · October 2026')
    expect(summary().textContent).toContain('₦3,000')
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
