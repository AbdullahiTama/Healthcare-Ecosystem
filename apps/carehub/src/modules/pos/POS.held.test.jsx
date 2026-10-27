// Held sales: open and edit, add or remove products, or complete — never delete.
// A held sale is not a sale (or a financial transaction) until it is charged.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  open: [],
  recent: [],
  saleCreate: vi.fn(),
  saleUpdate: vi.fn(),
  updateHeld: vi.fn(),
  refund: vi.fn(),
}))

vi.mock('../../hooks/queries', () => ({
  useTodaySales: vi.fn(() => ({ data: [], isLoading: false })),
  useOpenSales: vi.fn(() => ({ data: h.open, isLoading: false, isError: false, refetch: vi.fn() })),
  useRecentSales: vi.fn(() => ({ data: h.recent, isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() })),
  useCreateClient: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useInvalidateSales: vi.fn(() => vi.fn()),
}))
vi.mock('./repositories', async (orig) => {
  const real = await orig()
  return {
    ...real,
    saleRepository: { ...real.saleRepository, create: h.saleCreate, update: h.saleUpdate, updateHeld: h.updateHeld, history: vi.fn(async () => []) },
    paymentRepository: { ...real.paymentRepository, getForSale: vi.fn(async () => []), refund: h.refund },
  }
})
vi.mock('../debts/repositories', () => ({ debtRepository: { recordUnderpayment: vi.fn(async () => ({})) } }))
vi.mock('../consultation/repositories', () => ({ consultationRepository: { getLatest: vi.fn(async () => null) } }))

import POS from './POS.jsx'

const BRAND = { id: 'biz-1', name: 'Pharm Tama' }
const PRODUCTS = [
  { id: 'p1', name: 'Amoxicillin 500mg', category: 'Prescription Drugs', price: 1200, stock: 20 },
  { id: 'p2', name: 'Vitamin C', category: 'Supplements', price: 300, stock: 20 },
]
const HELD = { id: 'h1', txn_no: 'HLD-1', client_name: 'Ada Obi', is_on_hold: true, status: null, total: 2400, discount: 0, notes: 'back in 30 min',
  created_at: '2026-10-27T09:00:00', items: JSON.stringify([{ id: 'p1', name: 'Amoxicillin 500mg', price: 1200, qty: 2 }]) }
const DONE = { id: 's1', txn_no: 'TXN-9', client_name: 'Bisi', is_on_hold: false, total: 1200, amount_paid: 1200, payment_method: 'Cash',
  created_at: '2026-10-27T10:00:00', items: JSON.stringify([{ id: 'p1', name: 'Amoxicillin 500mg', price: 1200, qty: 1 }]) }

let host, root
const buttons = () => [...host.querySelectorAll('button')]
const button = (text) => buttons().find((b) => b.textContent.trim() === text)
const hasText = (t) => host.textContent.includes(t)
async function click(el) { await act(async () => { el.click() }) }
async function mount(role = 'Owner') {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><POS brand={BRAND} products={PRODUCTS} setProducts={vi.fn()} role={role} perms={{ canEditPrice: true }} /></MemoryRouter>)
  })
}
const tab = (name) => buttons().find((b) => b.textContent.trim().startsWith(name) && b.getAttribute('role') !== 'radio')

beforeEach(() => {
  h.open = [HELD]; h.recent = [DONE]
  h.saleCreate.mockReset().mockResolvedValue({ queued: false })
  h.saleUpdate.mockReset().mockResolvedValue(undefined)
  h.updateHeld.mockReset().mockResolvedValue(undefined)
  h.refund.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Held sales', () => {
  it('offers Open & edit but no Delete — not even to the Owner', async () => {
    await mount('Owner')
    await click(tab('Held'))
    expect(hasText('Ada Obi')).toBe(true)
    expect(button('Open & edit')).toBeTruthy()
    expect(buttons().some((b) => /delete/i.test(b.textContent))).toBe(false)
    expect(host.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull()
  })

  it('opening a held sale loads the cart and does not touch the held row', async () => {
    await mount('Owner')
    await click(tab('Held'))
    await click(button('Open & edit'))
    expect(hasText('Editing held sale HLD-1')).toBe(true)
    expect(hasText('Amoxicillin 500mg')).toBe(true)
    // The old behaviour flipped is_on_hold and set status 'resumed'/'deleted' here, which made it look like a sale.
    expect(h.saleUpdate).not.toHaveBeenCalled()
    expect(h.updateHeld).not.toHaveBeenCalled()
    expect(h.saleCreate).not.toHaveBeenCalled()
  })

  it('holding again saves the edits onto the SAME held row instead of creating another', async () => {
    await mount('Owner')
    await click(tab('Held'))
    await click(button('Open & edit'))
    await click(host.querySelector('button.pos-hold'))
    await click(button('Hold sale'))
    expect(h.updateHeld).toHaveBeenCalledTimes(1)
    expect(h.updateHeld.mock.calls[0][0]).toBe('h1')
    expect(h.updateHeld.mock.calls[0][2]).toMatchObject({ total: 2400, clientName: 'Ada Obi' })
    expect(h.saleCreate).not.toHaveBeenCalled()
    expect(h.saleUpdate).not.toHaveBeenCalled()
  })

  it('completing a resumed held sale records ONE new sale tagged resumed_from, and never PATCHes the held row', async () => {
    await mount('Owner')
    await click(tab('Held'))
    await click(button('Open & edit'))
    await click(host.querySelector('button.pos-charge'))
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
    const sale = h.saleCreate.mock.calls[0][1]
    expect(sale).toMatchObject({ is_on_hold: false, resumed_from: 'h1' })
    expect(h.saleUpdate).not.toHaveBeenCalled()
  })
})

describe('Recent sales', () => {
  it('offers Reprint only: no Refund, Edit, Delete or repayment — even for the Owner', async () => {
    await mount('Owner')
    await click(tab('Recent'))
    expect(button('Reprint')).toBeTruthy()
    expect(buttons().some((b) => /refund/i.test(b.textContent))).toBe(false)
    await click(host.querySelector('button[aria-label^="View sale TXN-9"]'))
    await act(async () => {})
    const labels = buttons().map((b) => b.textContent.trim())
    expect(labels).toContain('Reprint')
    for (const banned of ['Refund', 'Edit', 'Delete', 'Record repayment']) expect(labels).not.toContain(banned)
  })
})
