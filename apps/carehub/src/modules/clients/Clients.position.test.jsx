// A client's account position on their profile (Client owes us / We owe client / Settled), from the open debts Debt
// Management shows, and Add opening balance for the Owner or a manager.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getAll: vi.fn(), getSales: vi.fn(async () => []), getAppointments: vi.fn(async () => []), getDebts: vi.fn(async () => []), getConsultations: vi.fn(async () => []) }))
const debts = vi.hoisted(() => ({ getOpen: vi.fn(), create: vi.fn() }))
vi.mock('./repositories', () => ({ clientRepository: repo, isDuplicateError: () => false }))
vi.mock('../debts/repositories', () => ({ debtRepository: debts }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-16' }))

import Clients from './Clients.jsx'

let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush(); await flush() }
const dialog = () => document.querySelector('[role="dialog"]')
const panel = () => dialog().querySelector('section[aria-label="Account position"]')
const type = async (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })) }); await flush() }
async function mount(role = 'Owner') {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><MemoryRouter><Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role={role} /></MemoryRouter></QueryClientProvider>) })
  await flush(); await flush()
}
const open = async (name) => click([...document.querySelectorAll('div')].reverse().find((d) => d.textContent === name))

beforeEach(() => {
  vi.clearAllMocks()
  repo.getAll.mockResolvedValue([
    { id: 'c1', full_name: 'Ada Obi', phone: '0801', total_spend: 0, visit_count: 0 },
    { id: 'c2', full_name: 'Musa Bello', phone: '0802', total_spend: 0, visit_count: 0 },
    { id: 'c3', full_name: 'Chi Eze', phone: '0803', total_spend: 0, visit_count: 0 },
  ])
  debts.getOpen.mockResolvedValue([
    { client_id: 'c1', direction: 'owes_us', balance: 4000, status: 'pending', source: 'credit_sale' },
    { client_id: 'c1', direction: 'we_owe', balance: 1000, status: 'pending', source: 'manual', source_ref: 'opening_balance' },
    { client_id: 'c2', direction: 'we_owe', balance: 2500, status: 'pending', source: 'manual', source_ref: 'opening_balance' },
  ])
  debts.create.mockResolvedValue([{}])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); qc.clear(); document.body.innerHTML = '' })

describe('Client profile: account position', () => {
  it('nets what the client owes against what we owe them, and shows both parts', async () => {
    await mount()
    await open('Ada Obi')
    expect(panel().textContent).toContain('Client owes us ₦3,000')
    expect(panel().textContent).toContain('Owes us ₦4,000 · we owe them ₦1,000')
  })

  it('shows We owe client and Settled', async () => {
    await mount()
    await open('Musa Bello')
    expect(panel().textContent).toContain('We owe client ₦2,500')
    await click(btn((b) => b.getAttribute('aria-label') === 'Close' || b.textContent.trim() === '×', dialog()) || btn((b) => /close/i.test(b.getAttribute('aria-label') || ''), dialog()))
    await open('Chi Eze')
    expect(panel().textContent).toContain('Settled')
  })

  it('records an opening balance as an opening entry on the client\'s account', async () => {
    await mount()
    await open('Chi Eze')
    await click(btn((b) => b.textContent.includes('Add opening balance'), dialog()))
    await click([...dialog().querySelectorAll('input[type="radio"]')].find((r) => r.parentElement.textContent.includes('We Owe Client')))
    await type(dialog().querySelector('#opening-amount'), '1200')
    await type(dialog().querySelector('#opening-date'), '2026-10-31')
    await click(btn((b) => b.textContent === 'Save opening balance', dialog()))
    expect(debts.create).toHaveBeenCalledWith('b1', expect.objectContaining({ client_id: 'c3', party_name: 'Chi Eze', direction: 'we_owe', amount: 1200, source: 'manual', source_ref: 'opening_balance', created_at: '2026-10-31' }))
    expect(document.body.textContent).toContain('Opening balance recorded: We Owe Client ₦1,200.')
  })

  it('says so when the client already has an opening balance', async () => {
    debts.create.mockRejectedValue(new Error('duplicate key value violates unique constraint "debts_one_opening_balance_per_client"'))
    await mount()
    await open('Chi Eze')
    await click(btn((b) => b.textContent.includes('Add opening balance'), dialog()))
    await type(dialog().querySelector('#opening-amount'), '500')
    await click(btn((b) => b.textContent === 'Save opening balance', dialog()))
    expect(dialog().textContent).toContain('Chi Eze already has an opening balance.')
  })

  it('is not offered to a role that does not record debts', async () => {
    await mount('Cashier')
    await open('Chi Eze')
    expect(panel().textContent).toContain('Settled')
    expect(btn((b) => b.textContent.includes('Add opening balance'), dialog())).toBeUndefined()
  })
})
