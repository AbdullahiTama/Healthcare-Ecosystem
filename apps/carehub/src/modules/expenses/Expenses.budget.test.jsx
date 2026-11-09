// The expense budget "suddenly disappeared": it lived only in this browser's
// localStorage, per month, so a new month, another device or cleared site data
// lost it. It is now stored in the database (expense_budgets), carries over to
// following months, and a failed read is never shown as "no budget".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  expenseRepository: {
    getAll: vi.fn(), create: vi.fn(), delete: vi.fn(), getById: vi.fn(),
    getBudget: vi.fn(), getBudgetMonths: vi.fn(), setBudget: vi.fn(),
  },
}))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), currentMonth: () => '2026-11', todayDate: () => '2026-11-04' }))

import Expenses from './Expenses.jsx'
import { expenseRepository as repo } from './repositories'

const BIZ = 'biz-A'
const LEGACY_KEY = 'carehub_expense_budget'
let host, root, stored

async function mount(role = 'Owner') {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><Expenses brand={{ id: BIZ }} role={role} perms={{ canDelete: true }} /></MemoryRouter>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const text = () => document.body.textContent
const click = async (label) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === label || x.textContent.includes(label))
  if (!b) throw new Error('no button: ' + label)
  await act(async () => { b.click() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const setValue = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const budgetInput = () => [...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('Monthly Budget')) && document.getElementById([...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('Monthly Budget')).htmlFor)
const monthInput = () => document.querySelector('input[type="month"]')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  stored = {} // the database: { 'YYYY-MM': amount }
  // The page reads every expense and totals the month on the device: ₦12,000 in November, ₦30,000 in October.
  repo.getAll.mockResolvedValue([
    { id: 'n1', category: 'Rent', amount: 12000, date: '2026-11-02', created_at: '2026-11-02T09:00:00' },
    { id: 'o1', category: 'Rent', amount: 30000, date: '2026-10-02', created_at: '2026-10-02T09:00:00' },
  ])
  repo.getBudget.mockImplementation(async (_b, month) => {
    const m = Object.keys(stored).filter((k) => k <= month).sort().pop()
    return m ? { month: m, amount: stored[m] } : null
  })
  repo.getBudgetMonths.mockImplementation(async () => Object.keys(stored).sort())
  repo.setBudget.mockImplementation(async (_b, month, amount) => { stored[month] = amount; return { month, amount } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Expense budget', () => {
  it('a budget set in October still shows in November, carried over, with November spending deducted', async () => {
    stored = { '2026-10': 50000 }
    await mount()
    expect(text()).toContain('Carried over from 2026-10 budget')
    expect(text()).toContain('₦50,000')
    expect(text()).toContain('₦38,000') // 50,000 - 12,000 spent in November
    expect(text()).not.toContain('Set a monthly expense budget')
  })

  it('staff see the budget too (it is stored for the business, not in the Owner\'s browser)', async () => {
    stored = { '2026-11': 50000 }
    await mount('Cashier')
    expect(text()).toContain('Budget tracker')
    expect(text()).toContain('₦38,000')
    expect(text()).toContain('Set by Owner')
  })

  it('setting a budget saves it to the database and shows it', async () => {
    await mount()
    await click('Set budget')
    await setValue(budgetInput(), '50000')
    await click('Save Budget')
    expect(repo.setBudget).toHaveBeenCalledWith(BIZ, '2026-11', 50000)
    expect(text()).toContain('Budget set to ₦50,000 from 2026-11.')
    expect(text()).toContain('₦38,000')
  })

  it('a failed save keeps the dialog open and changes nothing', async () => {
    repo.setBudget.mockRejectedValueOnce(new Error('Supabase error (500): down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount()
    await click('Set budget')
    await setValue(budgetInput(), '50000')
    await click('Save Budget')
    expect(text()).toContain('Could not save the budget. Nothing was changed')
    expect(budgetInput()).not.toBeNull()
    expect(text()).not.toContain('Budget tracker')
  })

  it('budgets held in this browser by the old screen are moved to the database on the Owner\'s first visit', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ [BIZ]: { '2026-10': 50000, '2026-09': 40000 }, 'other-biz': { '2026-10': 1 } }))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    await mount()
    expect(repo.setBudget.mock.calls).toEqual([[BIZ, '2026-09', 40000], [BIZ, '2026-10', 50000]])
    expect(text()).toContain('Carried over from 2026-10 budget')
    expect(text()).toContain('₦38,000')
    // moved ones leave the browser; another business's are untouched
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY))).toEqual({ 'other-biz': { '2026-10': 1 } })
  })

  it('a month already stored in the database is not overwritten by an old browser value', async () => {
    stored = { '2026-10': 60000 }
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ [BIZ]: { '2026-10': 50000 } }))
    await mount()
    expect(repo.setBudget).not.toHaveBeenCalled()
    expect(text()).toContain('₦60,000')
    expect(localStorage.getItem(LEGACY_KEY)).toBe('{}')
  })

  it('staff never upload browser budgets (only the Owner can set one)', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ [BIZ]: { '2026-10': 50000 } }))
    await mount('Cashier')
    expect(repo.setBudget).not.toHaveBeenCalled()
  })

  it('a budget that could not be loaded is shown as an error, never as "no budget"', async () => {
    repo.getBudget.mockRejectedValueOnce(new Error('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stored = { '2026-11': 50000 }
    await mount()
    expect(text()).toContain('The budget could not be loaded. It has not been lost.')
    expect(text()).not.toContain('Set a monthly expense budget')
    const retry = [...document.querySelectorAll('[role="alert"] button')].find((b) => b.textContent === 'Try again')
    await act(async () => { retry.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(text()).toContain('₦38,000')
  })

  it('when spending cannot be loaded, the tracker does not claim the whole budget remains', async () => {
    stored = { '2026-11': 50000 }
    repo.getAll.mockRejectedValue(new Error('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount()
    expect(text()).toContain('Budget tracker')
    expect(text()).toContain('spending could not be loaded')
    expect(text()).not.toContain('Over budget')
    // only the budget figure is shown; no "remaining" amount equal to the whole budget
    expect(text().match(/₦50,000/g)).toHaveLength(1)
  })

  it('a budget of 0 stops the carry-over from that month', async () => {
    stored = { '2026-10': 50000, '2026-11': 0 }
    await mount()
    expect(text()).not.toContain('Budget tracker')
    expect(text()).toContain('Set a monthly expense budget')
  })

  it('looking at an earlier month shows that month\'s own budget and spending', async () => {
    stored = { '2026-10': 50000, '2026-11': 70000 }
    await mount()
    await setValue(monthInput(), '2026-10')
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(text()).toContain('₦20,000') // 50,000 - 30,000
    expect(text()).not.toContain('Carried over')
  })

  it('before the database update is installed, the budget stays on this device, as before, and says so', async () => {
    const missing = new Error('Supabase error (404): Could not find the table \'public.expense_budgets\' in the schema cache')
    repo.getBudgetMonths.mockRejectedValue(missing)
    repo.getBudget.mockRejectedValue(missing)
    repo.setBudget.mockRejectedValue(new Error('Supabase error (404): Could not find the function public.set_expense_budget'))
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ [BIZ]: { '2026-10': 50000 } }))
    await mount()
    expect(text()).toContain('Carried over from 2026-10 budget')
    expect(text()).toContain('saved on this device only')
    await click('Edit budget')
    await setValue(budgetInput(), '65000')
    await click('Save Budget')
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY))[BIZ]).toEqual({ '2026-10': 50000, '2026-11': 65000 })
    expect(text()).toContain('₦53,000')
  })
})
