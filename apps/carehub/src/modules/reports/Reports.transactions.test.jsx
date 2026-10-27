// Financial Reports: search the period's transactions, open one in full, and
// edit / refund / delete it — the Owner only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const now = new Date()
const iso = (d, h = 10) => new Date(now.getFullYear(), now.getMonth(), d, h).toISOString().slice(0, 19)
const h = vi.hoisted(() => ({ sales: [], remove: vi.fn(), correct: vi.fn(), refund: vi.fn() }))

vi.mock('../pos/repositories', () => ({
  saleRepository: {
    getSince: vi.fn(async () => h.sales),
    getOpen: vi.fn(async () => []),
    history: vi.fn(async () => [{ id: 'a1', action: 'sale.edited', actor_type: 'owner', created_at: '2026-10-20T08:00:00Z', metadata: { reason: 'typo at till', before: { total: 900 }, after: { total: 800 } } }]),
    correct: h.correct,
    remove: h.remove,
  },
  paymentRepository: {
    getForSale: vi.fn(async () => [{ id: 'p1', kind: 'sale', method: 'Cash', amount: 1500, received_at: '2026-10-20T08:00:00Z', staff_name: 'Bisi' }]),
    refund: h.refund,
    recordCollection: vi.fn(),
  },
  isMissingObject: () => false,
}))
vi.mock('../expenses/repositories', () => ({ expenseRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../purchases/repositories', () => ({ purchaseRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../adr/repositories', () => ({ adrReportRepository: { getReports: vi.fn(async () => []) } }))
vi.mock('../../hooks/queries', () => ({
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: [{ id: 'c1', full_name: 'Ada Okafor', phone: '0803 111 2222', email: 'ada@x.test' }] })),
}))
vi.mock('../inventory/hooks/useProductCatalog', () => ({ useProductCatalog: vi.fn(() => ({ products: [{ id: 'p9', name: 'Vitamin C', price: 300 }] })) }))
vi.mock('../../hooks/usePlanGate', () => ({ usePlanGate: () => ({ allow: () => true }) }))

import Reports from './Reports.jsx'

const BRAND = { id: 'biz-1', name: 'Pharm Tama' }
const sale = (o) => ({ business_id: 'biz-1', is_on_hold: false, status: null, subtotal: o.total, discount: 0, amount_paid: o.total, balance: 0, payment_method: 'Cash', refunded_amount: 0, items: '[]', ...o })

let host, root
const buttons = () => [...host.querySelectorAll('button')]
const labels = () => buttons().map((b) => b.textContent.trim())
const rowFor = (txn) => buttons().find((b) => (b.getAttribute('aria-label') || '').startsWith('Open ' + txn))
async function click(el) { await act(async () => { el.click() }) }
async function type(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function mount(role) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Reports brand={BRAND} role={role} perms={{}} embedded /></QueryClientProvider>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}

beforeEach(() => {
  h.sales = [
    sale({ id: 's1', txn_no: 'TXN-1001', client_id: 'c1', client_name: 'Ada Okafor', total: 1500, subtotal: 1500, created_at: iso(2),
      items: JSON.stringify([{ id: 'p1', name: 'Paracetamol 500mg', price: 750, qty: 2 }]), staff_name: 'Bisi' }),
    sale({ id: 's2', txn_no: 'TXN-1002', client_name: 'Bola Ade', total: 25000, subtotal: 25000, amount_paid: 10000, balance: 15000, is_credit: true, payment_method: 'Credit', created_at: iso(2, 11) }),
    sale({ id: 's3', txn_no: 'TXN-1003', client_name: 'Chidi', total: 800, subtotal: 800, refunded_amount: 300, created_at: iso(2, 12) }),
    // None of these is a sale:
    sale({ id: 'x1', txn_no: 'HLD-1', client_name: 'Held Person', total: 777, is_on_hold: true, created_at: iso(2) }),
    sale({ id: 'x2', txn_no: 'TXN-DEL', client_name: 'Deleted Person', total: 999, status: 'deleted', created_at: iso(2) }),
    sale({ id: 'x3', txn_no: 'TXN-RES', client_name: 'Resumed Person', total: 555, status: 'resumed', created_at: iso(2) }),
  ]
  h.remove.mockReset().mockResolvedValue({}); h.correct.mockReset().mockResolvedValue({}); h.refund.mockReset().mockResolvedValue({})
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Financial Reports transactions', () => {
  it('lists completed sales only: held, deleted and resumed rows are not transactions', async () => {
    await mount('Owner')
    for (const t of ['TXN-1001', 'TXN-1002', 'TXN-1003']) expect(rowFor(t)).toBeTruthy()
    expect(host.textContent).not.toMatch(/Held Person|Deleted Person|Resumed Person/)
    expect(host.textContent).toContain('3 in this period')
  })

  it('revenue is net of refunds', async () => {
    await mount('Owner')
    // 1500 + 25000 + (800 - 300)
    expect(host.textContent).toContain('₦27,000')
  })

  it('searches by customer, receipt number and amount, and clears', async () => {
    await mount('Owner')
    const box = host.querySelector('input[aria-label="Search transactions"]')
    await type(box, 'okafor'); expect(rowFor('TXN-1001') && !rowFor('TXN-1002') && !rowFor('TXN-1003')).toBeTruthy()
    expect(host.textContent).toContain('1 of 3 match')
    await type(box, '1003'); expect(rowFor('TXN-1003') && !rowFor('TXN-1001')).toBeTruthy()
    await type(box, '25,000'); expect(rowFor('TXN-1002') && !rowFor('TXN-1001')).toBeTruthy()
    await type(box, 'nobody here'); expect(host.textContent).toContain('No transactions match')
    await click(host.querySelector('button[aria-label="Clear search"]'))
    expect(rowFor('TXN-1001') && rowFor('TXN-1002') && rowFor('TXN-1003')).toBeTruthy()
  })

  it('the Owner opens a transaction in full and can Edit, Refund and Delete', async () => {
    await mount('Owner')
    await click(rowFor('TXN-1001'))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const text = document.body.textContent
    for (const part of ['Ada Okafor', '0803 111 2222', 'ada@x.test', 'Paracetamol 500mg', '×2', 'Total', 'Paid', 'Payments', 'Paid at the till', 'Change history', 'typo at till']) {
      expect(text, part).toContain(part)
    }
    const all = [...document.body.querySelectorAll('button')].map((b) => b.textContent.trim())
    for (const a of ['Reprint', 'Edit', 'Refund', 'Delete']) expect(all).toContain(a)
  })

  it('Delete needs a reason, then calls the owner function', async () => {
    await mount('Owner')
    await click(rowFor('TXN-1001'))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const btn = (t) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    await click(btn('Delete'))
    await click(btn('Delete sale'))
    expect(h.remove).not.toHaveBeenCalled() // no reason yet
    await type(document.body.querySelector('input[placeholder^="e.g. Duplicate"]'), 'Duplicate entry')
    await click(btn('Delete sale'))
    expect(h.remove).toHaveBeenCalledWith('s1', 'Duplicate entry')
  })

  it('Edit previews the new totals and sends server-checked lines with a reason', async () => {
    await mount('Owner')
    await click(rowFor('TXN-1001'))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const btn = (t) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    await click(btn('Edit'))
    await type(document.body.querySelector('input[aria-label="Quantity for Paracetamol 500mg"]'), '1')
    expect(document.body.textContent).toContain('New total')
    expect(document.body.textContent).toContain('₦750')
    expect(document.body.textContent).toContain('refund due')
    await type(document.body.querySelector('input[placeholder^="e.g. Wrong quantity"]'), 'Customer took one pack')
    await click(btn('Save changes'))
    expect(h.correct).toHaveBeenCalledTimes(1)
    const [id, body] = h.correct.mock.calls[0]
    expect(id).toBe('s1')
    expect(body).toMatchObject({ discount: 0, clientId: 'c1', clientName: 'Ada Okafor', reason: 'Customer took one pack' })
    expect(body.items).toEqual([{ id: 'p1', name: 'Paracetamol 500mg', price: 750, qty: 1 }])
  })

  it('a Manager (or anyone who is not the Owner) can open the details but gets no Edit, Refund or Delete', async () => {
    for (const role of ['Manager', 'Pharmacist']) {
      await mount(role)
      await click(rowFor('TXN-1001'))
      await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
      const all = [...document.body.querySelectorAll('button')].map((b) => b.textContent.trim())
      expect(all).toContain('Reprint')
      for (const a of ['Edit', 'Refund', 'Delete']) expect(all, role + ' ' + a).not.toContain(a)
      expect(document.body.textContent).not.toContain('Change history')
      await act(async () => root.unmount()); host.remove()
    }
    // afterEach unmounts again; give it something valid
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
})
