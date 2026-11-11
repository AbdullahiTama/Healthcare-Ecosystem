// "Set new budget": once the budget is used up the Owner could only Edit it, which rewrote the month as if the bigger
// figure had always applied and kept counting the spending that exhausted it. Now the Owner starts a new budget from
// a day in the month: the old one is kept in the budget history with what was spent, and the new one counts spending
// from its start (carehub_20270116_expense_new_budget).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  expenseRepository: {
    getAll: vi.fn(), create: vi.fn(), delete: vi.fn(), getById: vi.fn(),
    getBudget: vi.fn(), getBudgetMonths: vi.fn(), setBudget: vi.fn(), startNewBudget: vi.fn(), getBudgetHistory: vi.fn(),
  },
}))
vi.mock('../../lib/utils', async (orig) => ({ ...(await orig()), currentMonth: () => '2026-11', todayDate: () => '2026-11-18' }))

import Expenses from './Expenses.jsx'
import { expenseRepository as repo } from './repositories'

const BIZ = 'biz-A'
let host, root, current, history

async function mount(role = 'Owner') {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><Expenses brand={{ id: BIZ }} role={role} perms={{ canDelete: true }} /></MemoryRouter>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const text = () => document.body.textContent
const buttons = (label) => [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === label)
const click = async (el) => {
  await act(async () => { el.click() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const field = (id) => document.getElementById(id)
const setValue = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const notFound = () => Object.assign(new Error('Supabase error (404): Could not find the table public.expense_budget_history'), {})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // November: 52,000 spent by the 17th against a 50,000 budget set in October; 4,000 on the 18th.
  repo.getAll.mockResolvedValue([
    { id: 'a', category: 'Rent', amount: 40000, date: '2026-11-02', created_at: '2026-11-02T09:00:00' },
    { id: 'b', category: 'Fuel', amount: 12000, date: '2026-11-17', created_at: '2026-11-17T09:00:00' },
    { id: 'c', category: 'Fuel', amount: 4000, date: '2026-11-18', created_at: '2026-11-18T09:00:00' },
  ])
  current = { month: '2026-10', amount: 50000, startsOn: null }
  history = []
  repo.getBudget.mockImplementation(async () => ({ ...current }))
  repo.getBudgetMonths.mockResolvedValue(['2026-10'])
  repo.getBudgetHistory.mockImplementation(async () => history)
  repo.startNewBudget.mockImplementation(async (_b, month, amount, startsOn) => {
    history = [{ id: 'h1', month, amount: 50000, startsOn: '2026-11-01', endedOn: '2026-11-17', spent: 52000, reason: 'replaced', newAmount: amount, closedAt: 't' }]
    current = { month, amount, startsOn }
    return { ...current }
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('Set new budget', () => {
  it('a used-up budget offers Set new budget; it closes the old one and counts the new one from its start', async () => {
    await mount()
    expect(text()).toContain('Over budget!')
    expect(text()).toContain('This budget is used up')
    await click(buttons('Set new budget')[0])
    // The start defaults to today; the preview splits the month at it.
    expect(field('expense-new-budget-start').value).toBe('2026-11-18')
    expect(text()).toMatch(/Current budget closes on 17 Nov₦52,000 spent of ₦50,000/)
    expect(text()).toMatch(/Already spent from 18 Nov₦4,000/)
    await setValue(field('expense-new-budget-amount'), '30000')
    expect(text()).toMatch(/New budget remaining₦26,000/)
    await click(buttons('Start new budget')[0])

    expect(repo.startNewBudget).toHaveBeenCalledWith(BIZ, '2026-11', 30000, '2026-11-18')
    expect(text()).toContain('New budget from 2026-11-18')
    expect(text()).toContain('₦26,000') // 30,000 - 4,000 spent from the 18th; the earlier 52,000 is not counted
    expect(text()).not.toContain('Over budget!')
    // The old budget is kept and shown with what was spent.
    expect(text()).toContain('Earlier budgets in 2026-11 (1)')
    expect(text()).toMatch(/₦50,000 from 1 Nov to 17 Nov, replaced by ₦30,000/)
    expect(text()).toContain('₦52,000 spent (over by ₦2,000)')
  })

  it('checks the amount and the start before saving', async () => {
    await mount()
    await click(buttons('Set new budget')[0])
    await click(buttons('Start new budget')[0])
    expect(text()).toContain('Enter the new budget.')
    await setValue(field('expense-new-budget-amount'), '30000')
    await setValue(field('expense-new-budget-start'), '2026-11-01')
    await click(buttons('Start new budget')[0])
    expect(text()).toContain('Choose a day from 2026-11-02 to 2026-11-30.')
    expect(repo.startNewBudget).not.toHaveBeenCalled()
  })

  it('a refused save keeps the dialog open and changes nothing', async () => {
    repo.startNewBudget.mockRejectedValueOnce(new Error('network down'))
    await mount()
    await click(buttons('Set new budget')[0])
    await setValue(field('expense-new-budget-amount'), '30000')
    await click(buttons('Start new budget')[0])
    expect(text()).toContain('Could not set the new budget. Nothing was changed; please try again.')
    expect(field('expense-new-budget-amount')).not.toBeNull()
    expect(text()).toContain('Over budget!')
  })

  it('staff see the budget and its history but cannot set a new one', async () => {
    current = { month: '2026-11', amount: 30000, startsOn: '2026-11-18' }
    history = [{ id: 'h1', month: '2026-11', amount: 50000, startsOn: '2026-11-01', endedOn: '2026-11-17', spent: 52000, reason: 'replaced', newAmount: 30000, closedAt: 't' }]
    await mount('Cashier')
    expect(text()).toContain('New budget from 2026-11-18')
    expect(text()).toContain('Earlier budgets in 2026-11 (1)')
    expect(buttons('Set new budget')).toHaveLength(0)
  })

  it('before the database update: Edit only, as before', async () => {
    repo.getBudgetHistory.mockRejectedValue(notFound())
    await mount()
    expect(text()).toContain('Edit budget')
    expect(buttons('Set new budget')).toHaveLength(0)
    expect(text()).not.toContain('could not be loaded')
  })

  it('a failed history read is shown as such, with a retry', async () => {
    repo.getBudgetHistory.mockRejectedValueOnce(new Error('network down'))
    await mount()
    expect(text()).toContain('Earlier budgets for 2026-11 could not be loaded.')
    await click(buttons('Try again').at(-1))
    expect(repo.getBudgetHistory).toHaveBeenCalledTimes(2)
    expect(text()).not.toContain('could not be loaded')
  })

  it('Edit after a new budget keeps counting from the new start', async () => {
    current = { month: '2026-11', amount: 30000, startsOn: '2026-11-18' }
    repo.setBudget.mockImplementation(async (_b, month, amount) => { current = { month, amount, startsOn: '2026-11-18' }; return { ...current } })
    await mount()
    await click(buttons('Edit budget')[0])
    expect(text()).toContain('Already spent (since 2026-11-18)')
    const input = document.getElementById([...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('Monthly Budget')).htmlFor)
    await setValue(input, '35000')
    await click(buttons('Save Budget')[0])
    expect(text()).toContain('₦31,000') // 35,000 - 4,000
  })
})
