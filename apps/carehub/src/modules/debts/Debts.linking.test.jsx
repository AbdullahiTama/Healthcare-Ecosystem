// Debts: Record Debt links each debt to its client (creating a missing client once) or to the supplier's account, and
// older unlinked customer debts can be linked. (The Excel/CSV import links in the database: Debts.importExport.test.jsx.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({ getAll: vi.fn(), getForBusinesses: vi.fn(), create: vi.fn(), update: vi.fn(), getDeletions: vi.fn() }))
const clientRepo = vi.hoisted(() => ({ create: vi.fn() }))
const invalidateDebts = vi.hoisted(() => vi.fn())
const clientList = vi.hoisted(() => ({ rows: [] }))
vi.mock('./repositories', () => ({ debtRepository: repo }))
vi.mock('../clients/repositories', () => ({ clientRepository: clientRepo }))
vi.mock('../locations/repositories', () => ({ locationsRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../../hooks/queries', () => ({
  useClients: () => ({ data: clientList.rows, isLoading: false, isError: false, isSuccess: true }),
  useSettings: () => ({ data: {} }), useInvalidateSales: () => () => {}, useInvalidateDebts: () => invalidateDebts,
  useDebtPayments: () => ({ data: [], isLoading: false, isError: false }), useRecordDebtPayment: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('../purchases/hooks', () => ({ useSupplierDirectory: () => ({ suppliers: [{ key: 'emzor distributors', name: 'Emzor Distributors' }], isLoading: false, isError: false }) }))

import Debts from './Debts.jsx'

let host, root, db
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await flush() }
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const text = () => document.body.textContent
const dialog = () => document.querySelector('[role="dialog"]')
const field = (labelText) => {
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes(labelText))
  return document.getElementById(label.htmlFor)
}
const type = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  await flush()
}
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<Debts brand={{ id: 'B1' }} role='Owner' perms={{}} staffName='Ada' />) })
  await settle()
}
beforeEach(() => {
  vi.clearAllMocks()
  clientList.rows = [{ id: 'c1', full_name: 'Ada Obi', phone: '08031234567' }]
  db = []
  let n = 0
  repo.getAll.mockImplementation(async () => db.map((x) => ({ ...x })))
  repo.create.mockImplementation(async (_b, d) => { const row = { id: 'd' + (++n), business_id: 'B1', created_at: '2026-11-15', ...d }; db.push(row); return [row] })
  repo.update.mockImplementation(async (id, _b, u) => { db = db.map((x) => (x.id === id ? { ...x, ...u } : x)) })
  clientRepo.create.mockImplementation(async (_b, c) => [{ id: 'new-' + c.full_name, ...c }])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Record Debt links the debt', () => {
  it('creates a client record for a new customer and links the debt to it', async () => {
    await mount()
    await click(btn((b) => b.textContent.includes('+ Record Debt')))
    await type(document.getElementById('debt-party'), 'Chidi Eze')
    expect(text()).toContain('New client record for Chidi Eze')
    await type(field('Phone (optional)'), '0812 000 1111')
    await type(field('Total Amount'), '5000')
    await click(btn((b) => b.textContent === 'Save Debt'))
    await settle()
    expect(clientRepo.create).toHaveBeenCalledWith('B1', expect.objectContaining({ full_name: 'Chidi Eze', phone: '0812 000 1111' }))
    expect(repo.create).toHaveBeenCalledWith('B1', expect.objectContaining({ client_id: 'new-Chidi Eze', party_name: 'Chidi Eze', direction: 'owes_us', balance: 5000 }))
    expect(text()).toContain('A client record was created for Chidi Eze')
    expect(invalidateDebts).toHaveBeenCalled()
  })

  it('links an existing client typed in other capitals, without creating one', async () => {
    await mount()
    await click(btn((b) => b.textContent.includes('+ Record Debt')))
    await type(document.getElementById('debt-party'), 'ADA obi')
    expect(text()).toContain('Linked to client Ada Obi')
    await type(field('Total Amount'), '700')
    await click(btn((b) => b.textContent === 'Save Debt'))
    await settle()
    expect(clientRepo.create).not.toHaveBeenCalled()
    expect(repo.create.mock.calls[0][1]).toMatchObject({ client_id: 'c1', party_name: 'Ada Obi' })
  })

  it('asks which client when two share the name, and saves only once one is chosen', async () => {
    clientList.rows = [...clientList.rows, { id: 'c2', full_name: 'Musa', phone: '0801' }, { id: 'c3', full_name: 'Musa', phone: '0802' }]
    await mount()
    await click(btn((b) => b.textContent.includes('+ Record Debt')))
    await type(document.getElementById('debt-party'), 'Musa')
    await type(field('Total Amount'), '100')
    const save = btn((b) => b.textContent === 'Save Debt')
    expect(save.disabled).toBe(true)
    await type(document.getElementById('debt-client-choice'), 'c3')
    expect(save.disabled).toBe(false)
    await click(save)
    await settle()
    expect(repo.create.mock.calls[0][1]).toMatchObject({ client_id: 'c3' })
  })

  it('records a supplier debt in the supplier\'s account under its saved spelling', async () => {
    await mount()
    await click(btn((b) => b.textContent.includes('+ Record Debt')))
    await click([...document.querySelectorAll('input[type="radio"]')][1])
    await type(document.getElementById('debt-party'), 'emzor distributors')
    expect(text()).toContain('Added to supplier Emzor Distributors')
    await type(field('Total Amount'), '90000')
    await click(btn((b) => b.textContent === 'Save Debt'))
    await settle()
    expect(repo.create.mock.calls[0][1]).toMatchObject({ direction: 'we_owe', party_name: 'Emzor Distributors', client_id: null })
    expect(text()).toContain("Debt recorded in Emzor Distributors's supplier account.")
  })

  it('offers a supplier known only from an earlier debt, and saves under its spelling', async () => {
    db = [{ id: 'old', business_id: 'B1', direction: 'we_owe', party_name: 'Landlord Ltd', amount: 500, amount_paid: 0, balance: 500, status: 'pending', source: null, created_at: '2026-11-01' }]
    await mount()
    await click(btn((b) => b.textContent.includes('+ Record Debt')))
    await click([...document.querySelectorAll('input[type="radio"]')][1])
    const options = [...document.querySelectorAll('#debt-suppliers option')].map((o) => o.value)
    expect(options).toEqual(['Emzor Distributors', 'Landlord Ltd'])
    await type(document.getElementById('debt-party'), 'LANDLORD LTD')
    expect(text()).toContain('Added to supplier Landlord Ltd')
    await type(field('Total Amount'), '800')
    await click(btn((b) => b.textContent === 'Save Debt'))
    await settle()
    expect(repo.create.mock.calls[0][1]).toMatchObject({ party_name: 'Landlord Ltd', direction: 'we_owe' })
  })

  it('a retry after a refused debt reuses the client it already created', async () => {
    repo.create.mockRejectedValueOnce(new Error('Supabase error (500): try again'))
    await mount()
    await click(btn((b) => b.textContent.includes('+ Record Debt')))
    await type(document.getElementById('debt-party'), 'Chidi Eze')
    await type(field('Total Amount'), '5000')
    await click(btn((b) => b.textContent === 'Save Debt'))
    await settle()
    expect(text()).toContain('Could not save debt')
    expect(text()).toContain('Linked to client Chidi Eze')
    await click(btn((b) => b.textContent === 'Save Debt'))
    await settle()
    expect(clientRepo.create).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenLastCalledWith('B1', expect.objectContaining({ client_id: 'new-Chidi Eze' }))
  })
})

describe('Older unlinked customer debts', () => {
  it('are offered for linking, and link to the client or a new one', async () => {
    db = [
      { id: 'u1', business_id: 'B1', direction: 'owes_us', party_name: 'ada obi', amount: 100, balance: 100, status: 'pending', source: null, client_id: null, created_at: '2026-11-01' },
      { id: 'u2', business_id: 'B1', direction: 'owes_us', party_name: 'Tunde', amount: 200, balance: 200, status: 'pending', source: null, client_id: null, created_at: '2026-11-02' },
    ]
    await mount()
    expect(text()).toContain('2 customer debts are not linked to a client record')
    await click(btn((b) => b.textContent === 'Link to clients'))
    await settle()
    expect(repo.update.mock.calls).toEqual([['u1', 'B1', { client_id: 'c1' }], ['u2', 'B1', { client_id: 'new-Tunde' }]])
    expect(text()).toContain('2 debts linked to client records, 1 new client record created.')
    expect(text()).not.toContain('not linked to a client record')
  })
})

// Edit Client: a debt linked to a client shows the client's current name (and what it was recorded as), is found by
// it, and keeps party_name as recorded.
describe('Debts linked to a renamed client', () => {
  it('shows and finds the current name, notes the recorded one, and never rewrites the debt', async () => {
    clientList.rows = [{ id: 'c1', full_name: 'Ada Obi-Okafor', phone: '08031234567' }]
    db = [
      { id: 'd1', business_id: 'B1', direction: 'owes_us', party_name: 'Ada Obi', client_id: 'c1', amount: 5000, amount_paid: 0, balance: 5000, status: 'pending', source: 'manual', created_at: '2026-11-01' },
      { id: 'd2', business_id: 'B1', direction: 'owes_us', party_name: 'Walk-in Bisi', amount: 1000, amount_paid: 0, balance: 1000, status: 'pending', source: 'manual', created_at: '2026-11-02' },
    ]
    await mount()
    expect(text()).toContain('Ada Obi-Okafor')
    expect(text()).toContain('Recorded as Ada Obi')
    expect(text()).toContain('Walk-in Bisi')
    const search = document.querySelector('input[type="search"], input[aria-label*="Search"]')
    await type(search, 'okafor')
    await settle()
    expect(text()).toContain('Ada Obi-Okafor')
    expect(text()).not.toContain('Walk-in Bisi')
    // A debt recorded by hand opens its payment dialog, under the current name.
    await click(btn((b) => b.getAttribute('aria-label') === 'View debt: Ada Obi-Okafor'))
    expect(dialog().textContent).toContain('Ada Obi-Okafor')
    expect(repo.update).not.toHaveBeenCalled()
    expect(db[0].party_name).toBe('Ada Obi')
  })
})
