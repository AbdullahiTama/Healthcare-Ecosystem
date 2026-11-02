// The sale in progress survives leaving the POS, a held sale is written once however fast Hold is tapped, and an
// edited held sale is saved back onto itself — even after a reload — never held again as a copy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ open: [], openLoading: false, clients: [], saleCreate: vi.fn(), updateHeld: vi.fn() }))
vi.mock('../../hooks/queries', () => ({
  useTodaySales: vi.fn(() => ({ data: [], isLoading: false })),
  useOpenSales: vi.fn(() => ({ data: h.open, isLoading: h.openLoading, isError: false, refetch: vi.fn() })),
  useRecentSales: vi.fn(() => ({ data: [], isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: h.clients, isLoading: false, isError: false, refetch: vi.fn() })),
  useCreateClient: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useInvalidateSales: vi.fn(() => vi.fn()),
}))
vi.mock('./repositories', async (orig) => {
  const real = await orig()
  return { ...real, saleRepository: { ...real.saleRepository, create: h.saleCreate, updateHeld: h.updateHeld, history: vi.fn(async () => []) } }
})
vi.mock('../debts/repositories', () => ({ debtRepository: { recordUnderpayment: vi.fn(async () => ({})) } }))
vi.mock('../consultation/repositories', () => ({ consultationRepository: { getLatest: vi.fn(async () => null) } }))

import POS from './POS.jsx'
import { HeldSaleClosedError } from './repositories'

const BRAND = { id: 'biz-1', name: 'Pharm Tama' }
const PRODUCTS = [
  { id: 'p1', name: 'Amoxicillin 500mg', category: 'Prescription Drugs', price: 1200, stock: 20 },
  { id: 'p2', name: 'Vitamin C', category: 'Supplements', price: 300, stock: 20 },
]
const HELD = { id: 'h1', txn_no: 'HLD-1', client_name: 'Ada Obi', is_on_hold: true, status: null, subtotal: 2400, total: 2400, discount: 0, notes: 'back in 30 min',
  created_at: '2026-10-27T09:00:00', items: JSON.stringify([{ id: 'p1', name: 'Amoxicillin 500mg', price: 1200, qty: 2 }]) }

let host, root
const all = () => [...document.body.querySelectorAll('button')]
const button = (text) => all().find((b) => b.textContent.trim() === text)
const addBtn = (name) => document.body.querySelector(`button[aria-label^="Add ${name}"]`)
const hasText = (t) => document.body.textContent.includes(t)
const tab = (name) => all().find((b) => b.getAttribute('role') === 'tab' && b.textContent.trim().startsWith(name))
const cartLines = () => host.querySelectorAll('.pos-cart-item').length
async function flush() { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function click(el) { await act(async () => { el.click() }); await flush() }
function render(brand = BRAND) {
  return act(async () => {
    root.render(<MemoryRouter><POS brand={brand} products={PRODUCTS} setProducts={vi.fn()} role='Owner' perms={{ canEditPrice: true }} /></MemoryRouter>)
  })
}
async function mount(brand) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await render(brand)
}
// Leaving the POS (another screen, a reload onto a new build, a discarded tab): the component is gone, only what was
// stored on the device remains.
async function leaveAndReturn(brand) {
  await act(async () => root.unmount())
  root = createRoot(host)
  await render(brand)
}

beforeEach(() => {
  localStorage.clear()
  h.open = [HELD]; h.openLoading = false; h.clients = [{ id: 'c-ada', full_name: 'Ada Obi', phone: '0803 111 2222' }]
  h.saleCreate.mockReset().mockResolvedValue({ queued: false })
  h.updateHeld.mockReset().mockResolvedValue({ id: 'h1' })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('the sale in progress is not lost', () => {
  it('survives leaving the POS and coming back: products, quantities, customer and discount', async () => {
    await mount()
    await click(addBtn('Amoxicillin'))
    await click(addBtn('Amoxicillin'))
    await click(addBtn('Vitamin C'))
    await act(async () => {
      const discount = host.querySelector('input[placeholder="Discount"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(discount, '100'); discount.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await leaveAndReturn()
    expect(cartLines()).toBe(2)
    expect(host.querySelector('input[placeholder="Discount"]').value).toBe('100')
    expect(hasText('Charge ₦2,600')).toBe(true) // 2 × 1200 + 300 − 100
    expect(hasText('Picked up where you left off')).toBe(true)
  })

  it('is kept per location: another location starts with its own (empty) cart', async () => {
    await mount()
    await click(addBtn('Vitamin C'))
    await leaveAndReturn({ id: 'biz-2', name: 'Branch' })
    expect(cartLines()).toBe(0)
    await leaveAndReturn()
    expect(cartLines()).toBe(1)
  })

  it('is cleared once the sale is charged, so a reload on the receipt can never charge it again', async () => {
    await mount()
    await click(addBtn('Vitamin C'))
    await click(host.querySelector('button.pos-charge'))
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
    expect(hasText('Sale complete!')).toBe(true)
    await leaveAndReturn()
    expect(hasText('Sale complete!')).toBe(false)
    expect(cartLines()).toBe(0)
  })

  it('is cleared once the sale is held', async () => {
    await mount()
    await click(addBtn('Vitamin C'))
    await click(host.querySelector('button.pos-hold'))
    await click(button('Hold sale'))
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
    await leaveAndReturn()
    expect(cartLines()).toBe(0)
  })

  it('opening a held sale never silently replaces a different sale in the cart', async () => {
    await mount()
    await click(addBtn('Vitamin C'))
    await click(tab('Held'))
    await click(button('Open & edit'))
    expect(hasText('Replace the current sale?')).toBe(true)
    await click(button('Cancel'))
    await click(tab('Sell'))
    expect(cartLines()).toBe(1)
    expect(hasText('Editing held sale')).toBe(false)
  })

  it('stores the picked customer as id and name only, not their phone number', async () => {
    await mount()
    await click(addBtn('Vitamin C'))
    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('')
    expect(stored).toContain('Vitamin C')
    expect(stored).not.toContain('0803 111 2222')
  })
})

describe('a held sale is written once', () => {
  it('a double tap on Hold sale records one held sale', async () => {
    let finish
    h.saleCreate.mockImplementation(() => new Promise((r) => { finish = r }))
    await mount()
    await click(addBtn('Vitamin C'))
    await click(host.querySelector('button.pos-hold'))
    const holdBtn = button('Hold sale')
    await act(async () => { holdBtn.click(); holdBtn.click(); button('Hold & print invoice')?.click() })
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
    expect(button('Saving…').disabled).toBe(true)
    await act(async () => { finish({ queued: false }) })
    await flush()
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
  })
})

describe('an edited held sale is saved back onto itself', () => {
  it('after leaving the POS mid-edit, Save changes still updates THAT held sale (no second copy)', async () => {
    await mount()
    await click(tab('Held'))
    await click(button('Open & edit'))
    await click(addBtn('Vitamin C'))
    await leaveAndReturn()
    expect(hasText('Editing held sale HLD-1')).toBe(true)
    await click(host.querySelector('button.pos-hold'))
    await click(button('Save changes'))
    expect(h.updateHeld).toHaveBeenCalledTimes(1)
    expect(h.updateHeld.mock.calls[0][0]).toBe('h1')
    expect(h.updateHeld.mock.calls[0][2]).toMatchObject({ total: 2700 })
    expect(h.saleCreate).not.toHaveBeenCalled()
  })

  it('if the held sale was completed meanwhile, the cart is kept and the cashier is told; Hold then makes a new one', async () => {
    h.updateHeld.mockRejectedValue(new HeldSaleClosedError())
    await mount()
    await click(tab('Held'))
    await click(button('Open & edit'))
    await click(host.querySelector('button.pos-hold'))
    await click(button('Save changes'))
    expect(hasText('already completed')).toBe(true)
    expect(cartLines()).toBe(1)
    expect(hasText('Editing held sale')).toBe(false)
    await click(host.querySelector('button.pos-hold'))
    await click(button('Hold sale'))
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
    expect(h.saleCreate.mock.calls[0][1]).toMatchObject({ is_on_hold: true })
  })

  it('a restored edit whose held sale is no longer held becomes a new sale instead of being refused at charge', async () => {
    await mount()
    await click(tab('Held'))
    await click(button('Open & edit'))
    // charged on another till while this one was away
    h.open = []
    await leaveAndReturn()
    expect(hasText('Editing held sale')).toBe(false)
    expect(cartLines()).toBe(1)
    await click(host.querySelector('button.pos-charge'))
    expect(h.saleCreate.mock.calls[0][1]).not.toHaveProperty('resumed_from')
  })

  it('does not drop the held-sale link while the held list is still loading', async () => {
    await mount()
    await click(tab('Held'))
    await click(button('Open & edit'))
    h.open = []; h.openLoading = true
    await leaveAndReturn()
    expect(hasText('Editing held sale HLD-1')).toBe(true)
  })

  it('a failed save keeps every change on the till', async () => {
    h.updateHeld.mockRejectedValue(new Error('Supabase error (500): upstream'))
    await mount()
    await click(tab('Held'))
    await click(button('Open & edit'))
    await click(addBtn('Vitamin C'))
    await click(host.querySelector('button.pos-hold'))
    await click(button('Save changes'))
    expect(hasText('Your changes are kept')).toBe(true)
    expect(hasText('Editing held sale HLD-1')).toBe(true)
    expect(cartLines()).toBe(2)
  })
})
