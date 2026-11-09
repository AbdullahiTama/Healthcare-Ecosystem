// The client list filters, and totals that follow them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const clientsRepo = vi.hoisted(() => ({ getAll: vi.fn(), create: vi.fn(), createMany: vi.fn() }))
const debtsRepo = vi.hoisted(() => ({ getOpen: vi.fn() }))
vi.mock('./repositories', () => ({ clientRepository: clientsRepo, isDuplicateError: () => false }))
vi.mock('../debts/repositories', () => ({ debtRepository: debtsRepo }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))

import Clients from './Clients.jsx'

const CLIENTS = [
  { id: 'c1', full_name: 'Ada Obi', phone: '0801', gender: 'Female', total_spend: 12000, visit_count: 4, created_at: '2026-10-03T10:00:00' },
  { id: 'c2', full_name: 'Musa Bello', phone: '0802', gender: 'Male', total_spend: 0, visit_count: 0, created_at: '2026-09-15T10:00:00' },
  { id: 'c3', full_name: 'Chi Eze', phone: '0803', gender: 'Female', total_spend: 3000, visit_count: 1, created_at: '2025-06-01T10:00:00' },
]

let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const stat = (label) => [...host.querySelectorAll('div')].find((d) => d.children.length >= 2 && d.children[0].textContent.trim() === label)?.parentElement
const summary = () => host.querySelector('[role="status"][aria-live="polite"]')
async function choose(label, value) {
  const id = [...host.querySelectorAll('label')].find((l) => l.textContent.trim() === label).htmlFor
  const el = document.getElementById(id)
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
  await flush()
}
async function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter><Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role='Owner' /></MemoryRouter></QueryClientProvider>) })
  await flush(); await flush()
}
async function openFilters() {
  await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith('Client filters')).click() })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  clientsRepo.getAll.mockResolvedValue(CLIENTS)
  debtsRepo.getOpen.mockResolvedValue([{ client_id: 'c1', direction: 'owes_us', balance: 2500, status: 'pending' }])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear() })

describe('Clients: filters and totals', () => {
  it('totals every client with no filter, including what they owe', async () => {
    await mount()
    expect(stat('Total clients').textContent).toContain('3')
    expect(stat('Lifetime spend').textContent).toContain('₦15,000')
    expect(stat('Owed to you').textContent).toContain('₦2,500')
    expect(host.textContent).toContain('Owes ₦2,500')
    expect(summary()).toBeNull()
  })

  it('payment status "Owes money" leaves the debtors and recalculates the totals', async () => {
    await mount()
    await openFilters()
    await choose('Payment status', 'owes')
    expect(stat('Matching clients').textContent).toContain('1of 3')
    expect(stat('Lifetime spend').textContent).toContain('₦12,000')
    expect(summary().textContent).toContain('1 client for Owes money')
    expect(host.textContent).not.toContain('Musa Bello')
  })

  it('gender + date joined combine; no match offers to clear', async () => {
    await mount()
    await openFilters()
    await choose('Gender', 'Male')
    await choose('Date joined', 'year')
    await choose('Year', '2025')
    expect(host.textContent).toContain('No clients match')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear filters').click() })
    await flush()
    expect(stat('Total clients').textContent).toContain('3')
  })

  it('a failed client load shows an error with a retry, not "no clients"', async () => {
    clientsRepo.getAll.mockRejectedValue(new Error('offline'))
    await mount()
    expect(host.textContent).toContain("We couldn't load your clients")
    expect(host.textContent).not.toContain('No clients yet')
  })

  it('if debts cannot be read, the owed total says so and the payment filter is unavailable', async () => {
    debtsRepo.getOpen.mockRejectedValue(new Error('offline'))
    await mount()
    expect(stat('Owed to you').textContent).toContain("Couldn't load debts")
    await openFilters()
    expect(host.textContent).toContain('Unavailable: debts did not load')
  })
})
