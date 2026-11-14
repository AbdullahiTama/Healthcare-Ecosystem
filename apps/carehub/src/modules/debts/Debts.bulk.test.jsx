// Debts bulk actions: mark this location's debts, edit due date / description together, delete the hand-recorded ones
// (sale and purchase debts are kept with the reason), Undo and Recently deleted. Another location's debts cannot be
// marked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({
  getAll: vi.fn(), getForBusinesses: vi.fn(), create: vi.fn(), update: vi.fn(),
  updateMany: vi.fn(), deleteMany: vi.fn(), restoreDeleted: vi.fn(), getDeletions: vi.fn(),
}))
const locs = vi.hoisted(() => ({ getAll: vi.fn() }))
vi.mock('./repositories', () => ({ debtRepository: repo }))
vi.mock('../locations/repositories', () => ({ locationsRepository: locs }))
vi.mock('../../hooks/queries', () => ({ useClients: () => ({ data: [], isLoading: false, isError: false }), useSettings: () => ({ data: {} }), useInvalidateSales: () => () => {} }))

import Debts, { debtKeptText } from './Debts.jsx'

let db, host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const type = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  await flush()
}
const dialog = () => document.querySelector('[role="dialog"]')
const text = () => document.body.textContent
const box = (name) => document.querySelector(`input[aria-label^="Select debt: ${name}"]`)
async function mount(perms = {}, role = 'Owner') {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<Debts brand={{ id: 'B1' }} role={role} perms={perms} staffName='Ada' />) })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  locs.getAll.mockResolvedValue([])
  db = [
    { id: 'd1', business_id: 'B1', party_name: 'Ada', direction: 'owes_us', amount: 5000, amount_paid: 1000, balance: 4000, status: 'pending', source: 'manual', description: 'Borrowed cash', due_date: '', created_at: '2026-11-01' },
    { id: 'd2', business_id: 'B1', party_name: 'Landlord', direction: 'we_owe', amount: 20000, amount_paid: 0, balance: 20000, status: 'pending', source: null, description: 'Rent', due_date: '2026-12-01', created_at: '2026-11-02' },
    { id: 'd3', business_id: 'B1', party_name: 'Ben', direction: 'owes_us', amount: 3000, amount_paid: 0, balance: 3000, status: 'pending', source: 'credit_sale', source_ref: 'TXN-1', description: 'Credit sale', due_date: '', created_at: '2026-11-03' },
  ]
  repo.getAll.mockImplementation(async () => db.map((x) => ({ ...x })))
  repo.updateMany.mockImplementation(async (_b, ids, updates) => { db = db.map((x) => (ids.includes(x.id) ? { ...x, ...updates } : x)); return db.filter((x) => ids.includes(x.id)) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Debts: mark and edit', () => {
  it('sets a due date on all marked debts and the description only on hand-recorded ones', async () => {
    await mount()
    // Receivables first; the marks are per tab (switching tab clears them), so Landlord is marked on Payables alone.
    expect(box('Landlord')).toBeNull()
    await click(box('Ada')); await click(box('Ben'))
    expect(text()).toContain('2 selected')
    await click(btn((b) => b.textContent.includes('Edit selected')))
    expect(dialog().textContent).toContain('2 marked, ₦7,000 outstanding.')
    expect(dialog().textContent).toContain('1 marked debt comes from a credit sale or a purchase and keeps its description.')
    await type(dialog().querySelector('select'), 'set')
    await type(dialog().querySelector('input[type="date"]'), '2026-12-01')
    await type([...dialog().querySelectorAll('input')].find((i) => i.placeholder === 'Leave as it is'), 'Old balance')
    // Ben (credit sale) gets the date only.
    expect(dialog().textContent).toContain('2 of 2 debts will change.')
    await click(btn((b) => b.textContent.startsWith('Update 2 debts')))
    const calls = repo.updateMany.mock.calls.map(([, ids, u]) => [ids.slice().sort(), u])
    expect(calls).toContainEqual([['d1'], { due_date: '2026-12-01', description: 'Old balance' }])
    expect(calls).toContainEqual([['d3'], { due_date: '2026-12-01' }])
    expect(calls.some(([ids]) => ids.includes('d2'))).toBe(false)
    for (const [, u] of calls) expect(Object.keys(u).every((k) => k === 'due_date' || k === 'description')).toBe(true)
    expect(db.find((d) => d.id === 'd3').description).toBe('Credit sale')
  })

  it('a role without delete permission can edit but not delete', async () => {
    await mount({}, 'Cashier')
    await click(box('Ada'))
    expect(btn((b) => b.textContent.includes('Edit selected'))).toBeTruthy()
    expect(btn((b) => b.textContent.includes('Delete selected'))).toBeUndefined()
    expect(text()).not.toContain('Recently deleted')
  })
})

describe('Debts: delete selected and restore', () => {
  it('deletes the hand-recorded debt, shows the sale debt kept with why, and Undo restores', async () => {
    repo.deleteMany.mockImplementation(async (_b, ids) => {
      db = db.filter((x) => !(ids.includes(x.id) && x.id !== 'd3'))
      return { deletion_id: 'del1', deleted: 1, kept: [{ id: 'd3', name: 'Ben', reasons: ['credit_sale'], ref: 'TXN-1' }], not_found: 0 }
    })
    repo.restoreDeleted.mockResolvedValue({ restored: 1, skipped_already_back: 0, client_unlinked: 0 })
    await mount({ canDelete: true }, 'Manager')
    await click(box('Ada')); await click(box('Ben'))
    await click(btn((b) => b.textContent.includes('Delete selected')))
    expect(dialog().textContent).toContain('recorded by hand')
    await click(btn((b) => b.textContent.trim() === 'Delete 2' && b.closest('[role="dialog"]')))
    expect(repo.deleteMany).toHaveBeenCalledWith('B1', ['d1', 'd3'])
    expect(dialog().textContent).toContain('1 debt deleted.')
    expect(dialog().textContent).toContain('Ben: from credit sale TXN-1')
    await click(btn((b) => b.textContent.trim() === 'Undo'))
    expect(repo.restoreDeleted).toHaveBeenCalledWith('B1', 'del1')
    expect(dialog().textContent).toContain('1 debt restored.')
  })

  it('a refusal is shown and nothing changes', async () => {
    repo.deleteMany.mockRejectedValue(Object.assign(new Error('Only the owner, or a role allowed to delete, can do this.'), { code: 'DELETE_NOT_ALLOWED' }))
    await mount({ canDelete: true }, 'Manager')
    await click(box('Ada'))
    await click(btn((b) => b.textContent.includes('Delete selected')))
    await click(btn((b) => b.textContent.trim() === 'Delete 1' && b.closest('[role="dialog"]')))
    expect(dialog().textContent).toContain('Only the owner, or a role allowed to delete, can do this.')
    expect(box('Ada')).toBeTruthy()
  })

  it('Recently deleted lists debt deletions and restores one', async () => {
    repo.getDeletions.mockResolvedValue([{ deletion_id: 'del1', deleted_at: '2026-11-10T09:00:00Z', by: 'Ada', all: false, count: 2, restored: 0, names: ['Ada', 'Landlord'] }])
    repo.restoreDeleted.mockResolvedValue({ restored: 2, skipped_already_back: 0, client_unlinked: 1 })
    await mount()
    await click(btn((b) => b.textContent.includes('Recently deleted')))
    expect(dialog().textContent).toContain('2 debts deleted')
    await click(btn((b) => b.getAttribute('aria-label') === 'Restore 2 deleted debts'))
    expect(repo.restoreDeleted).toHaveBeenCalledWith('B1', 'del1')
    expect(text()).toContain('2 debts restored; 1 no longer linked to a deleted client.')
  })
})

describe('Debts: other locations', () => {
  it('a branch\'s debt has no checkbox and is never marked by "select all"', async () => {
    locs.getAll.mockResolvedValue([{ id: 'B1', name: 'Main' }, { id: 'B2', name: 'Ikeja' }])
    repo.getForBusinesses.mockResolvedValue([...db, { id: 'd9', business_id: 'B2', party_name: 'Zed', direction: 'owes_us', amount: 10, balance: 10, status: 'pending', source: 'manual', created_at: '2026-11-04' }])
    await mount()
    await click(btn((b) => b.textContent.includes('Debt filters')))
    const id = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Location').htmlFor
    await type(document.getElementById(id), '')
    expect(text()).toContain('Zed')
    expect(box('Zed')).toBeNull()
    await click(btn((b) => b.textContent === 'Select all 2 shown'))
    expect(text()).toContain('2 selected')
  })

  it('kept reasons read as sentences', () => {
    expect(debtKeptText(['purchase'], { ref: 'PO-7' })).toBe('from purchase PO-7: record the payment, or correct or delete the purchase, instead')
  })
})
