// A USB / Bluetooth scanner in keyboard mode types the code (then Enter) into
// whichever field has focus. Expenses has no barcode field: a scan into Amount
// became the expense (a 12-digit code is under the ₦1 trillion cap), into the
// budget became the budget, and its Enter pressed a focused Save Expense, Save
// Budget or Delete. Now a scan is undone, explained, and presses nothing.
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

const UPC = '615110000123' // 12 digits: 615,110,000,123 is under the ₦1 trillion expense cap
let host, root

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><Expenses brand={{ id: 'biz-A' }} role='Owner' perms={{ canDelete: true }} /></MemoryRouter>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const text = () => document.body.textContent
const $ = (sel) => document.body.querySelector(sel)
const button = (label) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === label).pop()
const click = async (el) => { await act(async () => { el.click() }); await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const setValue = (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
const keydown = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
async function scan(el, code, suffix = 'Enter') {
  await act(async () => {
    for (const ch of code) {
      keydown(el, ch)
      if (el.tagName === 'INPUT') setValue(el, el.value + ch)
    }
    if (suffix) keydown(el, suffix)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
const countEnter = (el) => { const n = { v: 0 }; el.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.v++ }); return n }

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  repo.getAll.mockResolvedValue([{ id: 'e1', category: 'Rent', description: 'Shop', amount: 1000, date: '2026-11-02', staff_name: '' }])
  repo.create.mockResolvedValue({ id: 'x' })
  repo.delete.mockResolvedValue(null)
  repo.getBudget.mockResolvedValue({ month: '2026-11', amount: 50000 })
  repo.getBudgetMonths.mockResolvedValue(['2026-11'])
  repo.setBudget.mockImplementation(async (_b, month, amount) => ({ month, amount }))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Expenses — a USB scan is never recorded', () => {
  it('a scan into Amount is undone, and its Enter does not save the expense', async () => {
    await mount()
    await click(button('Log expense'))
    await act(async () => { setValue(document.querySelector('[role="dialog"] select'), 'Rent'); setValue($('#expense-amount'), '1500') })
    const amount = $('#expense-amount')
    const enter = countEnter(amount)
    await scan(amount, UPC)
    expect(enter.v).toBe(0)
    expect($('#expense-amount').value).toBe('1500')
    expect(repo.create).not.toHaveBeenCalled()
    expect(text()).toContain('Scan ignored (' + UPC + '): Expenses has no barcode field, so nothing was changed.')
  })

  it('the scanner\'s Enter on a focused Save Expense button does not save', async () => {
    await mount()
    await click(button('Log expense'))
    await act(async () => { setValue(document.querySelector('[role="dialog"] select'), 'Rent'); setValue($('#expense-amount'), '1500') })
    const save = button('Save Expense')
    const enter = countEnter(save)
    await scan(save, UPC)
    expect(enter.v).toBe(0)
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('a scan into the budget is undone, and its Enter does not save the budget', async () => {
    await mount()
    await click(button('Edit budget'))
    const input = $('#expense-budget-amount')
    expect(input.value).toBe('50000')
    await scan(input, UPC, 'Tab')
    expect($('#expense-budget-amount').value).toBe('50000')
    const save = button('Save Budget')
    const enter = countEnter(save)
    await scan(save, UPC)
    expect(enter.v).toBe(0)
    expect(repo.setBudget).not.toHaveBeenCalled()
  })

  it('the scanner\'s Enter on the delete confirmation does not delete', async () => {
    await mount()
    await click(button('Delete'))
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].filter((b) => b.textContent.trim() === 'Delete').pop()
    const enter = countEnter(confirm)
    await scan(confirm, UPC)
    expect(enter.v).toBe(0)
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('a scan with nothing focused changes nothing and is explained', async () => {
    await mount()
    await scan(document.body, UPC)
    expect(text()).toContain('Scan ignored (' + UPC + ')')
    expect($('input[type="month"]').value).toBe('2026-11')
  })

  it('a scan without Enter is still undone once the keys stop', async () => {
    await mount()
    await click(button('Log expense'))
    await scan($('#expense-amount'), UPC, null)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect($('#expense-amount').value).toBe('')
  })

  it('Description and Recorded By are free text: a scanned receipt number stays there', async () => {
    await mount()
    await click(button('Log expense'))
    await scan($('#expense-description'), 'INV20261104', null)
    await scan($('#expense-recorded-by'), 'STAFF000123', null)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect($('#expense-description').value).toBe('INV20261104')
    expect($('#expense-recorded-by').value).toBe('STAFF000123')
    expect(text()).not.toContain('Scan ignored')
  })

  it('typing an amount by hand is not a scan', async () => {
    await mount()
    await click(button('Log expense'))
    const amount = $('#expense-amount')
    for (const ch of '2500000') {
      await act(async () => { keydown(amount, ch); setValue(amount, amount.value + ch) })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    expect(amount.value).toBe('2500000')
    expect(text()).not.toContain('Scan ignored')
  })

  it('fields outside Expenses are left alone', async () => {
    await mount()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      await scan(outside, UPC)
      expect(outside.value).toBe(UPC)
      expect(text()).not.toContain('Scan ignored')
    } finally {
      outside.remove()
    }
  })
})
