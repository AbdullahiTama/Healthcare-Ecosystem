// Expenses can be paid, part paid or unpaid; the page totals what is paid and still owed, filters by it, and pays
// off what is owed through Record payment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  expenseRepository: {
    getAll: vi.fn(), create: vi.fn(), delete: vi.fn(), getById: vi.fn(), recordPayment: vi.fn(), getPayments: vi.fn(),
    getBudget: vi.fn(async () => null), getBudgetMonths: vi.fn(async () => []), setBudget: vi.fn(),
  },
}))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), currentMonth: () => '2026-11', todayDate: () => '2026-11-09' }))

import Expenses from './Expenses.jsx'
import { expenseRepository as repo } from './repositories'

const ROWS = [
  { id: 'p', category: 'Rent', description: 'Shop rent', amount: 50000, amount_paid: 50000, date: '2026-11-01', created_at: '2026-11-01T09:00:00' },
  { id: 'h', category: 'Maintenance', description: 'Generator repair', amount: 20000, amount_paid: 5000, date: '2026-11-03', created_at: '2026-11-03T09:00:00' },
  { id: 'u', category: 'Utilities', description: 'Water bill', amount: 3000, amount_paid: 0, date: '2026-11-04', created_at: '2026-11-04T09:00:00' },
]

let host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const setInput = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
const byLabel = (label) => document.getElementById([...document.querySelectorAll('label')].find((l) => l.textContent.trim() === label).htmlFor)
const stat = (label) => [...host.querySelectorAll('div')].find((d) => d.children.length >= 2 && d.children[0].textContent.trim() === label)?.parentElement

async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><Expenses brand={{ id: 'biz-A' }} role='Owner' perms={{ canDelete: true }} staffName='Bisi' /></MemoryRouter>) })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  repo.getAll.mockResolvedValue(ROWS)
  repo.create.mockResolvedValue({ id: 'x' })
  repo.recordPayment.mockResolvedValue({ amount_paid: 20000, balance: 0 })
  repo.getPayments.mockResolvedValue([{ id: 'pp1', amount: 5000, method: 'Cash', kind: 'at_recording', paid_on: '2026-11-03', balance_after: 15000, staff_name: 'Ada' }])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Expenses: payment status', () => {
  it('totals what was spent, paid and is still to pay, and marks each row', async () => {
    await mount()
    expect(stat('Total spent').textContent).toContain('₦73,000')
    expect(stat('Paid').textContent).toContain('₦55,000')
    expect(stat('Still to pay').textContent).toContain('₦18,000')
    expect(stat('Still to pay').textContent).toContain('2 expenses not fully paid')
    expect(text()).toContain('Partially paid')
    expect(text()).toContain('₦15,000 to pay')
  })

  it('the payment status filter narrows the list and the totals together', async () => {
    await mount()
    await setInput(byLabel('Payment status'), 'unpaid')
    await flush()
    expect(stat('Total spent').textContent).toContain('₦3,000')
    expect(text()).not.toContain('Generator repair')
    expect(document.querySelector('[role="status"][aria-live="polite"]').textContent).toContain('Unpaid')
  })

  it('logs an unpaid bill and a part-paid expense with what was paid now', async () => {
    await mount()
    await click(btn((b) => b.textContent.includes('Log expense')))
    const dialog = () => document.querySelector('[role="dialog"]')
    await setInput(dialog().querySelector('select'), 'Rent')
    await setInput(dialog().querySelector('#expense-amount'), '10000')
    await click(btn((b) => b.getAttribute('role') === 'radio' && b.textContent === 'Not paid yet'))
    expect(text()).toContain('Still to pay: ₦10,000')
    await click(btn((b) => b.textContent.includes('Save Expense')))
    expect(repo.create.mock.calls[0][1]).toMatchObject({ amount: 10000, amount_paid: 0, payment_method: null })

    await click(btn((b) => b.textContent.includes('Log expense')))
    await setInput(dialog().querySelector('select'), 'Rent')
    await setInput(dialog().querySelector('#expense-amount'), '10000')
    await click(btn((b) => b.getAttribute('role') === 'radio' && b.textContent === 'Part paid'))
    await setInput(dialog().querySelector('#expense-amount-paid'), '4000')
    await click(btn((b) => b.getAttribute('role') === 'radio' && b.textContent === 'Transfer'))
    await click(btn((b) => b.textContent.includes('Save Expense')))
    expect(repo.create.mock.calls[1][1]).toMatchObject({ amount: 10000, amount_paid: 4000, payment_method: 'Transfer' })
  })

  it('Record payment pays off the rest, then reloads', async () => {
    await mount()
    await click(btn((b) => b.getAttribute('aria-label') === 'Record payment: Generator repair'))
    expect(document.querySelector('#expense-payment-amount').value).toBe('15000')
    await click(btn((b) => b.getAttribute('role') === 'radio' && b.textContent === 'POS'))
    const loads = repo.getAll.mock.calls.length
    await click(btn((b) => b.textContent.trim() === 'Record payment' && b.closest('[role="dialog"]')))
    expect(repo.recordPayment).toHaveBeenCalledWith('h', { amount: 15000, method: 'POS', paidOn: '2026-11-09', note: '', staffName: 'Bisi' })
    expect(text()).toContain('It is now paid in full.')
    expect(repo.getAll.mock.calls.length).toBeGreaterThan(loads)
  })

  it('paying more than is owed is stopped before any request; a refusal is shown in the dialog', async () => {
    await mount()
    await click(btn((b) => b.getAttribute('aria-label') === 'Record payment: Generator repair'))
    await setInput(document.querySelector('#expense-payment-amount'), '16000')
    await click(btn((b) => b.textContent.trim() === 'Record payment' && b.closest('[role="dialog"]')))
    expect(repo.recordPayment).not.toHaveBeenCalled()
    expect(text()).toContain('more than the ₦15,000 still owed')
    repo.recordPayment.mockRejectedValue(new Error('Supabase error (400): This expense is already paid in full.'))
    await setInput(document.querySelector('#expense-payment-amount'), '100')
    await click(btn((b) => b.textContent.trim() === 'Record payment' && b.closest('[role="dialog"]')))
    expect(text()).toContain('This expense is already paid in full.')
  })

  it('opening an expense shows what is paid, what is owed and the payment history', async () => {
    await mount()
    await click(btn((b) => (b.getAttribute('aria-label') || '').startsWith('View expense: Generator repair')))
    const dialog = document.querySelector('[role="dialog"]')
    expect(repo.getPayments).toHaveBeenCalledWith('biz-A', 'h')
    expect(dialog.textContent).toContain('Still to pay ₦15,000')
    expect(dialog.textContent).toContain('Paid when logged · Ada')
    expect(btn((b) => b.textContent.trim() === 'Record payment' && b.closest('[role="dialog"]'))).toBeTruthy()
  })

  it('before the database update is installed: everything reads as paid and nothing offers payment choices', async () => {
    repo.getAll.mockResolvedValue(ROWS.map(({ amount_paid, ...r }) => r))
    await mount()
    expect(stat('Still to pay').textContent).toContain('₦0')
    expect(btn((b) => (b.getAttribute('aria-label') || '').startsWith('Record payment'))).toBeUndefined()
    expect([...document.querySelectorAll('label')].some((l) => l.textContent.trim() === 'Payment status')).toBe(false)
    await click(btn((b) => b.textContent.includes('Log expense')))
    expect(text()).not.toContain('Not paid yet')
  })
})

describe('Expenses: opened from the dashboard\'s "Bills to pay"', () => {
  it('?payment=open shows every expense still to pay, whatever its date', async () => {
    repo.getAll.mockResolvedValue([...ROWS, { id: 'old', category: 'Rent', description: 'Old rent', amount: 8000, amount_paid: 0, date: '2020-05-01', created_at: '2020-05-01T09:00:00' }])
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root.render(<MemoryRouter initialEntries={['/dashboard/expenses?payment=open']}><Expenses brand={{ id: 'biz-A' }} role='Owner' perms={{}} staffName='Bisi' /></MemoryRouter>) })
    await flush()
    expect(text()).toContain('Old rent')
    expect(text()).toContain('Generator repair')
    expect(text()).not.toContain('Shop rent')
    expect(stat('Still to pay').textContent).toContain('₦26,000')
    expect(byLabel('Payment status').value).toBe('open')
  })
})

