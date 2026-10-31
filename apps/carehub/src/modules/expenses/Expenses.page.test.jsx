import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  expenseRepository: {
    getPage: vi.fn(),
    getTotals: vi.fn(),
    getCategories: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    getById: vi.fn(),
  },
}))

import Expenses from './Expenses.jsx'
import { expenseRepository as repo } from './repositories'

const brand = { id: 'biz-A' }
let host, root

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Expenses brand={brand} role='Owner' perms={{ canDelete: true }} />) })
  await act(async () => {})
}
const text = () => host.textContent
const click = async (label) => {
  const b = [...host.ownerDocument.querySelectorAll('button')].find((x) => x.textContent.includes(label))
  if (!b) throw new Error('no button: ' + label)
  await act(async () => { b.click() })
}
const setValue = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  await act(async () => { el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
async function fillAndSave({ category = 'Rent', amount = '1500.50' } = {}) {
  await click('Log expense')
  const modal = document.body
  const sel = modal.querySelector('select')
  if (category) await setValue(sel, category)
  const amountInput = [...modal.querySelectorAll('input[type=number]')].find((i) => i.min === '0')
  if (amount !== null) await setValue(amountInput, amount)
  await click('Save Expense')
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  repo.getPage.mockResolvedValue([{ id: 'e1', category: 'Rent', description: 'Shop', amount: 1000, date: '2026-10-05', staff_name: '' }])
  repo.getTotals.mockResolvedValue([{ total_amount: 1000, transaction_count: 1 }])
  repo.getCategories.mockResolvedValue([{ category: 'Rent', category_amount: 1000 }])
  repo.create.mockResolvedValue({ id: 'x' })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('Expenses page', () => {
  it('shows persisted rows and the total from the database', async () => {
    await mount()
    expect(text()).toContain('Shop')
    expect(text()).toContain('₦1,000')
  })

  it('a failed read shows an error with retry, not a zero total', async () => {
    repo.getPage.mockRejectedValue(new Error('structure of query does not match function result type'))
    await mount()
    expect(text()).toContain('Expenses could not be loaded')
    expect(text()).not.toContain('₦0')
    expect(text()).not.toContain('No expenses recorded')
    repo.getPage.mockResolvedValue([])
    await click('Try again')
    expect(repo.getPage.mock.calls.length).toBeGreaterThan(1)
  })

  it('saves a valid expense once, with an id, a numeric amount and the business, then reloads', async () => {
    await mount()
    const loads = repo.getPage.mock.calls.length
    await fillAndSave()
    expect(repo.create).toHaveBeenCalledTimes(1)
    const [biz, payload] = repo.create.mock.calls[0]
    expect(biz).toBe('biz-A')
    expect(payload).toMatchObject({ category: 'Rent', amount: 1500.5 })
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(text()).toContain('Expense logged!')
    expect(repo.getPage.mock.calls.length).toBeGreaterThan(loads)
  })

  it('a failed insert shows an error and never a success message', async () => {
    repo.create.mockRejectedValue(new Error('Supabase error (403): row-level security'))
    await mount()
    await fillAndSave()
    expect(text()).toContain('Nothing was recorded')
    expect(text()).not.toContain('Expense logged!')
  })

  it('rejects a non-positive amount before any request is made', async () => {
    await mount()
    await fillAndSave({ amount: '0' })
    expect(repo.create).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('greater than zero')
  })

  it('rejects a missing category before any request is made', async () => {
    await mount()
    await fillAndSave({ category: '' })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('a double click while the save is in flight sends one request', async () => {
    let release
    repo.create.mockImplementation(() => new Promise((r) => { release = r }))
    await mount()
    await click('Log expense')
    await setValue(document.body.querySelector('select'), 'Rent')
    await setValue([...document.body.querySelectorAll('input[type=number]')].find((i) => i.min === '0'), '40')
    const save = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Save Expense'))
    await act(async () => { save.click(); save.click() })
    expect(repo.create).toHaveBeenCalledTimes(1)
    await act(async () => { release({ id: 'x' }) })
  })
})

describe('opened from the Owner\'s business activity', () => {
  it('?expense=<id> shows that expense in full, with who recorded it', async () => {
    repo.getById.mockResolvedValue({ id: 'e-9', category: 'Transport', description: 'Fuel for delivery', amount: 2500, date: '2026-10-30',
      staff_name: 'Typed On Form', recorded_by_name: 'Rep Two', created_at: '2026-10-30T09:15:00' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/dashboard/expenses?expense=e-9']}><Expenses brand={brand} role='Owner' perms={{}} /></MemoryRouter>)
    })
    await act(async () => {})
    expect(repo.getById).toHaveBeenCalledWith('biz-A', 'e-9')
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('Fuel for delivery')
    expect(dialog.textContent).toContain('Rep Two')
    expect(dialog.textContent).toContain('Typed On Form')
    expect(dialog.textContent).toContain('2026-10-30 10:15')
  })
})
