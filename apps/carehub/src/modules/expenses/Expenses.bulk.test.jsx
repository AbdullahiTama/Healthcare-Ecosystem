// Expenses bulk actions: mark expenses, edit them together, delete them with their payment history kept for restore,
// Recently deleted, and the single Delete going through the same safe path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  expenseRepository: {
    getAll: vi.fn(), create: vi.fn(), delete: vi.fn(), getById: vi.fn(), recordPayment: vi.fn(), getPayments: vi.fn(async () => []),
    getBudget: vi.fn(async () => null), getBudgetMonths: vi.fn(async () => []), setBudget: vi.fn(),
    updateMany: vi.fn(), deleteMany: vi.fn(), restoreDeleted: vi.fn(), getDeletions: vi.fn(),
  },
}))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), currentMonth: () => '2026-11', todayDate: () => '2026-11-10' }))

import Expenses from './Expenses.jsx'
import { expenseRepository as repo } from './repositories'

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
const tick = (label) => click(document.querySelector(`input[aria-label^="Select ${label}"]`))
async function mount(perms = { canDelete: true }, role = 'Owner') {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><Expenses brand={{ id: 'B1' }} role={role} perms={perms} staffName='Ada' /></MemoryRouter>) })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  db = [
    { id: 'e1', category: 'Other', description: 'Fuel', amount: 800, amount_paid: 800, date: '2026-11-03', staff_name: '' },
    { id: 'e2', category: 'Other', description: 'Okada', amount: 300, amount_paid: 300, date: '2026-11-04', staff_name: '' },
    { id: 'e3', category: 'Rent', description: 'Shop rent', amount: 50000, amount_paid: 50000, date: '2026-11-01', staff_name: 'Musa' },
  ]
  repo.getAll.mockImplementation(async () => db.map((x) => ({ ...x })))
  repo.updateMany.mockImplementation(async (_b, ids, updates) => { db = db.map((x) => (ids.includes(x.id) ? { ...x, ...updates } : x)); return db.filter((x) => ids.includes(x.id)) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Expenses: mark and edit', () => {
  it('recategorises two expenses in one request and the list shows the new category', async () => {
    await mount()
    await tick('Other: Fuel'); await tick('Other: Okada')
    expect(text()).toContain('2 selected')
    await click(btn((b) => b.textContent.includes('Edit selected')))
    expect(dialog().textContent).toContain('2 marked, ₦1,100 in all.')
    await type(dialog().querySelector('select'), 'Transport')
    expect(dialog().textContent).toContain('2 of 2 expenses will change.')
    await click(btn((b) => b.textContent.startsWith('Update 2 expenses')))
    expect(repo.updateMany).toHaveBeenCalledTimes(1)
    expect(repo.updateMany).toHaveBeenCalledWith('B1', ['e1', 'e2'], { category: 'Transport' })
    expect(dialog().textContent).toContain('2 expenses updated.')
    await click(btn((b) => b.textContent.trim() === 'Done'))
    expect(document.querySelector('input[aria-label^="Select Transport: Fuel"]')).toBeTruthy()
  })

  it('a role without delete permission can edit but not delete', async () => {
    await mount({}, 'Cashier')
    await tick('Rent: Shop rent')
    expect(btn((b) => b.textContent.includes('Edit selected'))).toBeTruthy()
    expect(btn((b) => b.textContent.includes('Delete selected'))).toBeUndefined()
    expect(text()).not.toContain('Recently deleted')
  })
})

describe('Expenses: delete selected and restore', () => {
  it('deletes the marked expenses (totals drop), offers Undo, and restores them', async () => {
    repo.deleteMany.mockImplementation(async (_b, ids) => { db = db.filter((x) => !ids.includes(x.id)); return { deletion_id: 'd1', deleted: ids.length, kept: [], not_found: 0 } })
    repo.restoreDeleted.mockImplementation(async () => { db = [...db, { id: 'e3', category: 'Rent', description: 'Shop rent', amount: 50000, amount_paid: 50000, date: '2026-11-01' }]; return { restored: 1, skipped_already_back: 0 } })
    await mount()
    await tick('Rent: Shop rent')
    await click(btn((b) => b.textContent.includes('Delete selected')))
    expect(dialog().textContent).toContain('spending totals and the budget drop by ₦50,000')
    await click(btn((b) => b.textContent.trim() === 'Delete 1' && b.closest('[role="dialog"]')))
    expect(repo.deleteMany).toHaveBeenCalledWith('B1', ['e3'])
    expect(dialog().textContent).toContain('1 expense deleted.')
    await click(btn((b) => b.textContent.trim() === 'Undo'))
    expect(repo.restoreDeleted).toHaveBeenCalledWith('B1', 'd1')
    expect(dialog().textContent).toContain('1 expense restored.')
  })

  it('the single Delete uses the safe path with Undo; before the update it falls back to the old delete', async () => {
    repo.deleteMany.mockResolvedValueOnce({ deletion_id: 'd2', deleted: 1, kept: [], not_found: 0 })
    await mount()
    const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Okada'))
    await click([...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete'))
    expect(text()).toContain('You can undo it')
    await click(btn((b) => b.textContent.trim() === 'Delete' && b.closest('[role="dialog"], [role="alertdialog"]')))
    expect(repo.deleteMany).toHaveBeenCalledWith('B1', ['e2'])
    expect(btn((b) => b.textContent.trim() === 'Undo')).toBeTruthy()

    repo.deleteMany.mockRejectedValueOnce(Object.assign(new Error('needs update'), { code: 'DELETE_UNAVAILABLE' }))
    const row1 = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Fuel'))
    await click([...row1.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete'))
    await click(btn((b) => b.textContent.trim() === 'Delete' && b.closest('[role="dialog"], [role="alertdialog"]')))
    expect(repo.delete).toHaveBeenCalledWith('e1', 'B1')
  })

  it('Recently deleted lists expense deletions and restores one', async () => {
    repo.getDeletions.mockResolvedValue([{ deletion_id: 'd1', deleted_at: '2026-11-10T09:00:00Z', by: 'Ada', all: false, count: 2, restored: 0, names: ['Rent · Shop rent', 'Other · Fuel'] }])
    repo.restoreDeleted.mockResolvedValue({ restored: 2, skipped_already_back: 0 })
    await mount()
    await click(btn((b) => b.textContent.includes('Recently deleted')))
    expect(dialog().textContent).toContain('2 expenses deleted')
    await click(btn((b) => b.getAttribute('aria-label') === 'Restore 2 deleted expenses'))
    expect(repo.restoreDeleted).toHaveBeenCalledWith('B1', 'd1')
    expect(text()).toContain('2 expenses restored.')
  })
})
