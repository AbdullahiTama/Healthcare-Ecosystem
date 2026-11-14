// A USB / Bluetooth scanner in keyboard mode types the code (then Enter) into
// whichever field has focus. Debts has no barcode field: a scan into Total
// Amount became the debt, and its Enter pressed a focused Save Debt or Mark paid
// (which settles a hand-entered debt at once). Now a scan is undone, explained,
// and presses nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const debts = vi.hoisted(() => ({ getAll: vi.fn(), update: vi.fn(), create: vi.fn() }))
const sales = vi.hoisted(() => ({ getById: vi.fn() }))
const payments = vi.hoisted(() => ({ recordCollection: vi.fn() }))
vi.mock('./repositories', () => ({ debtRepository: debts }))
vi.mock('../../hooks/queries', () => ({ useClients: () => ({ data: [], isLoading: false, isError: false }), useSettings: () => ({ data: {} }), useInvalidateSales: () => () => {} }))
vi.mock('../pos/repositories', async (orig) => {
  const real = await orig()
  return { saleRepository: sales, paymentRepository: payments, isMissingObject: real.isMissingObject }
})

import Debts from './Debts.jsx'

const SALE_DEBT = { id: 'd1', party_name: 'Bola', direction: 'owes_us', amount: 100000, amount_paid: 70000, balance: 30000, status: 'pending', source: 'credit_sale', source_ref: 'TXN-1', created_at: '2026-10-21' }
const MANUAL_DEBT = { id: 'd2', party_name: 'Chidi', direction: 'owes_us', amount: 500, amount_paid: 0, balance: 500, status: 'pending', source: null, created_at: '2026-10-21' }
const UPC = '615110000123'

let host, root
async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Debts brand={{ id: 'b' }} role='Owner' perms={{}} />) })
  await act(async () => {})
}
const text = () => document.body.textContent
const buttons = (t) => [...host.querySelectorAll('button')].filter((b) => b.textContent.trim() === t)
const click = async (el) => { await act(async () => { el.click() }); await act(async () => {}) }
const byLabel = (t) => {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(t))
  return label && document.getElementById(label.htmlFor)
}
const setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const keydown = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
async function scan(el, code, suffix = 'Enter') {
  await act(async () => {
    for (const ch of code) {
      keydown(el, ch)
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') setValue(el, el.value + ch)
    }
    if (suffix) keydown(el, suffix)
  })
  await act(async () => {})
}
const countEnter = (el) => { const n = { v: 0 }; el.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.v++ }); return n }
async function openRecordDebt() {
  await click(buttons('+ Record Debt')[0])
  await act(async () => { setValue(host.querySelector('input[list="debt-clients"]'), 'Ada'); setValue(byLabel('Total Amount'), '5000') })
}

beforeEach(() => {
  vi.clearAllMocks()
  debts.getAll.mockResolvedValue([SALE_DEBT, MANUAL_DEBT])
  debts.update.mockResolvedValue(null)
  debts.create.mockResolvedValue([{ id: 'new' }])
  sales.getById.mockResolvedValue({ id: 'sale-1', txn_no: 'TXN-1', total: 100000, amount_paid: 70000 })
  payments.recordCollection.mockResolvedValue({ applied: 30000, balance: 0 })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Debts — a USB scan is never recorded', () => {
  it('a scan into Total Amount is undone, and its Enter does not save the debt', async () => {
    await render()
    await openRecordDebt()
    const amount = byLabel('Total Amount')
    const enter = countEnter(amount)
    await scan(amount, UPC)
    expect(enter.v).toBe(0)
    expect(byLabel('Total Amount').value).toBe('5000')
    expect(text()).toContain('₦5,000') // balance remaining still from 5,000
    expect(debts.create).not.toHaveBeenCalled()
    expect(text()).toContain('Scan ignored (' + UPC + '): Debts has no barcode field, so nothing was changed.')
  })

  it('a scan into the party name is undone too', async () => {
    await render()
    await openRecordDebt()
    await scan(host.querySelector('input[list="debt-clients"]'), UPC, 'Tab')
    expect(host.querySelector('input[list="debt-clients"]').value).toBe('Ada')
  })

  it('the scanner\'s Enter on a focused Save Debt does not save', async () => {
    await render()
    await openRecordDebt()
    const save = buttons('Save Debt')[0]
    const enter = countEnter(save)
    await scan(save, UPC)
    expect(enter.v).toBe(0)
    expect(debts.create).not.toHaveBeenCalled()
  })

  it('the scanner\'s Enter on a row\'s Record payment does not open or pay a hand-entered debt', async () => {
    await render()
    const recordPayment = host.querySelector('button[aria-label="Record payment: Chidi"]')
    const enter = countEnter(recordPayment)
    await scan(recordPayment, UPC)
    expect(enter.v).toBe(0)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(debts.update).not.toHaveBeenCalled()
  })

  it('the scanner\'s Enter on Record payment\'s Mark paid does not record the payment', async () => {
    await render()
    await click(buttons('Mark paid')[0])
    const confirm = buttons('Mark paid').at(-1)
    const enter = countEnter(confirm)
    await scan(confirm, UPC)
    expect(enter.v).toBe(0)
    expect(payments.recordCollection).not.toHaveBeenCalled()
    expect(debts.update).not.toHaveBeenCalled()
  })

  it('a scan into the search box is undone', async () => {
    await render()
    const search = host.querySelector('input[aria-label="Search receivables by customer name"]')
    await act(async () => { setValue(search, 'Bo') })
    await scan(search, UPC)
    expect(search.value).toBe('Bo')
    expect(text()).toContain('Bola')
  })

  it('a scan without Enter is still undone once the keys stop', async () => {
    await render()
    await openRecordDebt()
    await scan(byLabel('Amount Already Paid'), UPC, null)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect(byLabel('Amount Already Paid').value).toBe('')
  })

  it('the Description text area is left alone (a reference may be scanned there)', async () => {
    await render()
    await openRecordDebt()
    const desc = host.querySelector('[role="dialog"] textarea')
    await scan(desc, 'INV20261104')
    expect(desc.value).toBe('INV20261104')
    expect(text()).not.toContain('Scan ignored')
  })

  it('typing an amount by hand is not a scan', async () => {
    await render()
    await openRecordDebt()
    const paid = byLabel('Amount Already Paid')
    for (const ch of '2500000') {
      await act(async () => { keydown(paid, ch); setValue(paid, paid.value + ch) })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    expect(paid.value).toBe('2500000')
    expect(text()).not.toContain('Scan ignored')
  })

  it('fields outside Debts are left alone', async () => {
    await render()
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
