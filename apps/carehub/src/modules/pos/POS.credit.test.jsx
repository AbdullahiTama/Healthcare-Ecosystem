// A credit sale must be recorded against a customer record, chosen by the
// cashier, so every debt can be traced to the right person.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  clients: [],
  recent: [],
  createClient: vi.fn(),
  saleCreate: vi.fn(),
  recordUnderpayment: vi.fn(),
}))

vi.mock('../../hooks/queries', () => ({
  useTodaySales: vi.fn(() => ({ data: [], isLoading: false })),
  useOpenSales: vi.fn(() => ({ data: [], isLoading: false })),
  useRecentSales: vi.fn(() => ({ data: h.recent, isLoading: false, isError: false })),
  useSettings: vi.fn(() => ({ data: {} })),
  useClients: vi.fn(() => ({ data: h.clients, isLoading: false, isError: false, refetch: vi.fn() })),
  useCreateClient: vi.fn(() => ({ mutateAsync: h.createClient })),
  useInvalidateSales: vi.fn(() => vi.fn()),
}))
vi.mock('./repositories', async (orig) => {
  const real = await orig()
  return { ...real, saleRepository: { ...real.saleRepository, create: h.saleCreate, update: vi.fn() },
    paymentRepository: { ...real.paymentRepository, getForSale: vi.fn(async () => [{ id: 'p1', kind: 'sale', method: 'Transfer', amount: 2400, received_at: '2026-10-27T09:30:00Z', staff_name: 'Bisi' }]) } }
})
vi.mock('../debts/repositories', () => ({ debtRepository: { recordUnderpayment: h.recordUnderpayment } }))
vi.mock('../consultation/repositories', () => ({ consultationRepository: { getLatest: vi.fn(async () => null) } }))

import POS from './POS.jsx'

const BRAND = { id: 'biz-1', name: 'Pharm Tama' }
const PRODUCTS = [{ id: 'p1', name: 'Amoxicillin 500mg', category: 'Prescription Drugs', price: 1200, stock: 20 }]

let host, root
const buttons = () => [...host.querySelectorAll('button')]
const button = (text) => buttons().find((b) => b.textContent.trim() === text)
const chargeButton = () => host.querySelector('button.pos-charge')
function type(el, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
async function click(el) { await act(async () => { el.click() }) }

beforeEach(async () => {
  h.clients = [
    { id: 'c1', full_name: 'Mama Ngozi', phone: '0803 111 2222' },
    { id: 'c2', full_name: 'Ada Obi', phone: '0802 000 0001' },
    { id: 'c3', full_name: 'Ada Obi', phone: '0809 000 0002' },
  ]
  h.createClient.mockReset()
  h.saleCreate.mockReset().mockResolvedValue({ queued: false })
  h.recordUnderpayment.mockReset().mockResolvedValue({})
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter><POS brand={BRAND} products={PRODUCTS} setProducts={vi.fn()} role='Owner' perms={{ canEditPrice: true }} /></MemoryRouter>)
  })
  await click(button('Add'))
  await click(buttons().find((b) => b.className.includes('pos-pay-chip') && b.textContent.includes('Credit')))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('POS credit sale customer', () => {
  it('cannot be recorded until a customer is selected', async () => {
    expect(chargeButton().textContent).toBe('Select a customer')
    expect(chargeButton().disabled).toBe(true)
    expect(h.saleCreate).not.toHaveBeenCalled()
  })

  it('the cashier searches, picks the customer, and the sale and debt are linked to that record', async () => {
    await act(async () => type(host.querySelector('#credit-customer-search'), 'ngozi'))
    await click(buttons().find((b) => b.textContent.includes('Mama Ngozi')))
    expect(host.textContent).toContain('0803 111 2222')
    expect(chargeButton().textContent).toBe('Record credit sale')
    await click(chargeButton())
    expect(h.saleCreate).toHaveBeenCalledWith('biz-1', expect.objectContaining({ client_id: 'c1', client_name: 'Mama Ngozi', is_credit: true }))
    expect(h.recordUnderpayment).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1', partyName: 'Mama Ngozi', source: 'credit_sale' }))
  })

  it('two customers with the same name are told apart by phone; the one picked is used', async () => {
    await act(async () => type(host.querySelector('#credit-customer-search'), '0809'))
    const options = buttons().filter((b) => b.textContent.includes('Ada Obi'))
    expect(options).toHaveLength(1)
    await click(options[0])
    await click(chargeButton())
    expect(h.saleCreate).toHaveBeenCalledWith('biz-1', expect.objectContaining({ client_id: 'c3' }))
  })

  it('a new customer can be added without leaving the sale, then is selected', async () => {
    h.createClient.mockResolvedValue([{ id: 'c9', full_name: 'Baba Tunde', phone: '0805' }])
    await act(async () => type(host.querySelector('#credit-customer-search'), 'Baba Tunde'))
    await click(buttons().find((b) => b.textContent.includes('Add a new customer')))
    expect(host.querySelector('#credit-new-name').value).toBe('Baba Tunde')
    await act(async () => type(host.querySelector('#credit-new-phone'), '0805'))
    await act(async () => host.querySelector('form[aria-label="Add a new customer"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(h.createClient).toHaveBeenCalledWith({ full_name: 'Baba Tunde', phone: '0805' })
    expect(chargeButton().textContent).toBe('Record credit sale')
    await click(chargeButton())
    expect(h.saleCreate).toHaveBeenCalledWith('biz-1', expect.objectContaining({ client_id: 'c9' }))
  })

  it('changing the customer clears the selection and blocks the sale again', async () => {
    await act(async () => type(host.querySelector('#credit-customer-search'), 'ngozi'))
    await click(buttons().find((b) => b.textContent.includes('Mama Ngozi')))
    await click(host.querySelector('button[aria-label^="Change customer"]'))
    expect(chargeButton().disabled).toBe(true)
  })
})

describe('POS recent sales', () => {
  it('each sale opens in full: items, quantities, prices, payments and reprint', async () => {
    h.recent = [{ id: 's9', txn_no: 'TXN-900', client_name: 'Ada Obi', payment_method: 'Transfer', total: 2400, amount_paid: 2400, balance: 0,
      created_at: '2026-10-27T09:30:00', items: JSON.stringify([{ name: 'Amoxil 500mg', qty: 2, price: 1200 }]) }]
    await click(buttons().find((b) => b.getAttribute('role') === 'tab' && b.textContent.startsWith('Recent')))
    await click(host.querySelector('button[aria-label="View sale TXN-900 for Ada Obi"]'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('Receipt TXN-900')
    expect(dialog.textContent).toContain('Amoxil 500mg')
    expect(dialog.textContent).toContain('×2 @ ₦1,200')
    expect(dialog.textContent).toContain('Paid at the till · Transfer')
    expect(dialog.textContent).toContain('Reprint')
    h.recent = []
  })
})
