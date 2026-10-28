// Held sales: an invoice for the customer, and the customer record linked so the sale counts in their history.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ open: [], clients: [], saleCreate: vi.fn(), updateHeld: vi.fn() }))
vi.mock('../../hooks/queries', () => ({
  useTodaySales: vi.fn(() => ({ data: [], isLoading: false })),
  useOpenSales: vi.fn(() => ({ data: h.open, isLoading: false, isError: false, refetch: vi.fn() })),
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

const BRAND = { id: 'biz-1', name: 'Pharm Tama', address: '1 Marina' }
const PRODUCTS = [{ id: 'p1', name: 'Amoxicillin 500mg', category: 'Prescription Drugs', price: 1200, stock: 20 }]
const HELD = { id: 'h1', txn_no: 'HLD-1', client_name: 'Ada Obi', is_on_hold: true, status: null, subtotal: 2400, total: 2400, discount: 0, notes: 'back in 30 min',
  created_at: '2026-10-27T09:00:00', items: JSON.stringify([{ id: 'p1', name: 'Amoxicillin 500mg', price: 1200, qty: 2 }]) }

let host, root, printWin
const buttons = () => [...document.body.querySelectorAll('button')]
const button = (text) => buttons().find((b) => b.textContent.trim() === text)
async function click(el) { await act(async () => { el.click() }); await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><POS brand={BRAND} products={PRODUCTS} setProducts={vi.fn()} role='Owner' perms={{ canEditPrice: true }} /></MemoryRouter>)
  })
}
const tab = (name) => buttons().find((b) => b.textContent.trim().startsWith(name) && b.getAttribute('role') !== 'radio')
const written = () => printWin.document.write.mock.calls.map((c) => c[0]).join('')

beforeEach(() => {
  h.open = [HELD]; h.clients = [{ id: 'c-ada', full_name: 'Ada Obi' }]
  h.saleCreate.mockReset().mockResolvedValue({ queued: false })
  h.updateHeld.mockReset().mockResolvedValue(undefined)
  printWin = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn(), close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(printWin)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('Held sale invoice', () => {
  it('a held sale prints as an invoice: amount due, not paid, no payment method', async () => {
    await mount()
    await click(tab('Held'))
    await click(buttons().find((b) => b.getAttribute('aria-label')?.startsWith('Print invoice for Ada Obi')))
    const html = written()
    expect(html).toContain('<title>Invoice</title>')
    expect(html).toContain('INVOICE')
    expect(html).toContain('HLD-1')
    expect(html).toContain('Amoxicillin 500mg')
    expect(html).toContain('AMOUNT DUE')
    expect(html).toContain('₦2,400')
    expect(html).toContain('Not paid')
    expect(html).toContain('This is an invoice, not a receipt.')
    expect(html).toContain('Note: back in 30 min')
    expect(html).not.toContain('Receipt:')
    expect(html).not.toContain('Change')
  })

  it('Hold & print invoice saves the held sale with its customer record, then prints', async () => {
    h.open = []
    await mount()
    await click(button('Add'))
    const name = document.body.querySelector('input[list="pos-clients"]')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'ada obi'); name.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(document.body.querySelector('button.pos-hold'))
    await click(button('Hold & print invoice'))
    expect(h.saleCreate).toHaveBeenCalledTimes(1)
    const saved = h.saleCreate.mock.calls[0][1]
    expect(saved).toMatchObject({ is_on_hold: true, client_id: 'c-ada', amount_paid: 0, total: 1200 })
    expect(written()).toContain('INVOICE')
    expect(written()).toContain(saved.txn_no)
  })

  it('if the held sale is refused, no invoice is printed', async () => {
    h.open = []
    h.saleCreate.mockRejectedValue(new Error('Supabase error (400): price'))
    await mount()
    await click(button('Add'))
    await click(document.body.querySelector('button.pos-hold'))
    await click(button('Hold & print invoice'))
    expect(printWin.close).toHaveBeenCalled()
    expect(printWin.document.write).not.toHaveBeenCalled()
  })
})
