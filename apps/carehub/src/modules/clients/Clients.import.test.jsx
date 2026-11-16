// Clients › Upload clients (Excel / CSV) with opening balances: the preview checks every row, the import adds only
// new clients and records each opening balance as an opening entry on the client's account (a debt linked to the
// client, never a sale or a payment), for new and existing clients alike.
//
// Regression kept from the earlier upload: choosing a file once rendered a preview that read undefined identifiers
// and blanked the whole app; the preview must render and the Import button must disable while saving.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The real query hooks run; only the repositories underneath are replaced.
vi.mock('./repositories', () => ({
  clientRepository: { getAll: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  isDuplicateError: () => false,
}))
const debts = vi.hoisted(() => ({ getOpen: vi.fn(), create: vi.fn() }))
vi.mock('../debts/repositories', () => ({ debtRepository: debts }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-11-16' }))

import Clients from './Clients.jsx'
import { clientRepository } from './repositories'

// Row 2: new, owes us. Row 3: new, we owe. Row 4: an existing client (phone written differently) with an opening
// balance. Row 5: no phone. Row 6: repeats row 2's phone. Row 7: bad balance type. Row 8: new, no balance.
const CSV = [
  'Client Name,Phone Number,Address,Opening Balance,Balance Type,Opening Balance Date',
  'Ada Okafor,08012345678,12 Broad Street,"15,000",Client Owes Us,2026-10-31',
  'Musa Bello,08098765432,,5000,We Owe Client,31/10/2026',
  'Chi Existing,0803-111-2222,,2000,Client Owes Us,2026-10-01',
  'No Phone,,,,,',
  'Ada Again,0801 234 5678,,,,',
  'Bad Type,08055556666,,100,maybe,2026-10-01',
  'Plain Client,08077778888,Yaba,,,',
].join('\n')

let root, host, queryClient
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (pred) => [...document.querySelectorAll('button')].find(typeof pred === 'string' ? (b) => b.textContent.trim() === pred : pred)
const dialog = () => document.querySelector('[role="dialog"]')

async function mount(role = 'Owner') {
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}><MemoryRouter><Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role={role} /></MemoryRouter></QueryClientProvider>)
  })
  await flush(); await flush()
}
async function chooseFile(text, name = 'clients.csv') {
  await act(async () => { button('Upload clients').click() })
  const input = dialog().querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [new File([text], name, { type: 'text/csv' })], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  for (let i = 0; i < 20 && !dialog().textContent.includes('New clients'); i++) await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  clientRepository.getAll.mockResolvedValue([{ id: 'c1', full_name: 'Chi Existing', phone: '0803 111 2222', total_spend: 0, visit_count: 0 }])
  debts.getOpen.mockResolvedValue([])
  debts.create.mockResolvedValue([{}])
  clientRepository.createMany.mockImplementation(async (_b, rows) => ({
    added: rows.length, skipped: 0, failed: [], created: rows.map((r, i) => ({ id: 'new' + i, ...r })),
  }))
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); queryClient.clear(); document.body.innerHTML = '' })

describe('Clients: upload with opening balances', () => {
  it('previews every row: new, existing, repeated and invalid, with the opening balances', async () => {
    await mount()
    await chooseFile(CSV)
    const t = dialog().textContent
    expect(t).toContain('Row 2: Ada Okafor')
    expect(t).toContain('Client owes us ₦15,000')
    expect(t).toContain('We owe client ₦5,000')
    expect(t).toContain('Chi Existing is already in your list: the opening balance is added to their account.')
    expect(t).toContain('The phone number is missing.')
    expect(t).toContain('Same phone number as row 2')
    expect(t).toContain('Balance Type "maybe" is not Client Owes Us or We Owe Client.')
    expect(button((b) => b.textContent.startsWith('Import 3 clients and 3 opening balances')).disabled).toBe(false)
  })

  it('adds only the new clients, then records each opening balance as an opening entry on the right account', async () => {
    await mount()
    await chooseFile(CSV)
    await act(async () => { button((b) => b.textContent.startsWith('Import 3 clients')).click() })
    for (let i = 0; i < 10 && !dialog().textContent.includes('clients added'); i++) await flush()
    const [, fresh] = clientRepository.createMany.mock.calls[0]
    expect(fresh.map((c) => c.full_name)).toEqual(['Ada Okafor', 'Musa Bello', 'Plain Client'])
    const entries = debts.create.mock.calls.map(([biz, d]) => ({ biz, ...d }))
    expect(entries).toEqual([
      expect.objectContaining({ biz: 'b1', client_id: 'new0', party_name: 'Ada Okafor', direction: 'owes_us', amount: 15000, amount_paid: 0, source: 'manual', source_ref: 'opening_balance', description: 'Opening balance', created_at: '2026-10-31' }),
      expect.objectContaining({ client_id: 'new1', direction: 'we_owe', amount: 5000, created_at: '2026-10-31' }),
      expect.objectContaining({ client_id: 'c1', party_name: 'Chi Existing', direction: 'owes_us', amount: 2000, created_at: '2026-10-01' }),
    ])
    expect(dialog().textContent).toContain('3 clients added, 3 opening balances recorded.')
    expect(dialog().textContent).toContain('3 rows were not imported')
  })

  it('reports a client who already has an opening balance instead of adding a second', async () => {
    debts.create.mockImplementation(async (_b, d) => {
      if (d.client_id === 'c1') throw new Error('Supabase error (409): duplicate key value violates unique constraint "debts_one_opening_balance_per_client"')
      return [{}]
    })
    await mount()
    await chooseFile(CSV)
    await act(async () => { button((b) => b.textContent.startsWith('Import 3 clients')).click() })
    for (let i = 0; i < 10 && !dialog().textContent.includes('clients added'); i++) await flush()
    expect(dialog().textContent).toContain('2 opening balances recorded')
    expect(dialog().textContent).toContain('1 already had an opening balance, so it was not added again: Chi Existing.')
  })

  it('disables Import and shows "Importing…" while saving', async () => {
    clientRepository.createMany.mockReturnValue(new Promise(() => {}))
    await mount()
    await chooseFile(CSV)
    await act(async () => { button((b) => b.textContent.startsWith('Import 3 clients')).click() })
    await flush()
    const importing = button('Importing…')
    expect(importing).toBeTruthy()
    expect(importing.disabled).toBe(true)
  })

  it('still reads the previous template (First Name / Last Name)', async () => {
    await mount()
    await chooseFile('First Name,Last Name,Phone,Email,Gender,Date of Birth,Address,Notes\nAda,Okafor,08012345678,ada@email.com,Female,1990-05-12,12 Broad Street,VIP')
    expect(dialog().textContent).toContain('Row 2: Ada Okafor')
    expect(button((b) => b.textContent.trim() === 'Import 1 client')).toBeTruthy()
  })

  it('a role that cannot record debts imports clients but not their opening balances', async () => {
    await mount('Cashier')
    await chooseFile(CSV)
    expect(dialog().textContent).toContain('Opening balance not recorded: only the Owner or a manager can record opening balances.')
    // The row with a bad Balance Type is no longer an error: its balance is not read at all.
    await act(async () => { button((b) => b.textContent.trim() === 'Import 4 clients').click() })
    for (let i = 0; i < 10 && !dialog().textContent.includes('clients added'); i++) await flush()
    expect(debts.create).not.toHaveBeenCalled()
  })
})
