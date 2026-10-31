// Settling a debt that a credit sale raised must settle the sale too: it goes
// through record_sale_payment() with the method the customer paid by. Before
// the accounting migration exists, the previous debt-only update is kept.
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

let host, root
async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Debts brand={{ id: 'b' }} role='Owner' perms={{}} />) })
  await act(async () => {})
}
const buttons = (text) => [...host.querySelectorAll('button')].filter((b) => b.textContent.trim() === text)
const click = async (el) => { await act(async () => { el.click() }); await act(async () => {}) }

beforeEach(() => {
  vi.clearAllMocks()
  debts.getAll.mockResolvedValue([SALE_DEBT, MANUAL_DEBT])
  debts.update.mockResolvedValue(null)
  sales.getById.mockResolvedValue({ id: 'sale-1', txn_no: 'TXN-1', total: 100000, amount_paid: 70000 })
  payments.recordCollection.mockResolvedValue({ applied: 30000, balance: 0 })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Debts: mark paid', () => {
  it('a credit-sale debt asks how it was paid and settles the sale through the collection function', async () => {
    await render()
    await click(buttons('Mark paid')[0])
    await click([...host.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Transfer'))
    await click(buttons('Mark paid').at(-1))
    expect(sales.getById).toHaveBeenCalledWith('b', 'TXN-1')
    expect(payments.recordCollection).toHaveBeenCalledWith('sale-1', 30000, 'Transfer')
    expect(debts.update).not.toHaveBeenCalled()
  })

  it('falls back to the debt-only update while the collection function is not deployed', async () => {
    payments.recordCollection.mockRejectedValue(new Error('Supabase error (404): PGRST202 Could not find the function public.record_sale_payment'))
    await render()
    await click(buttons('Mark paid')[0])
    await click(buttons('Mark paid').at(-1))
    expect(debts.update).toHaveBeenCalledWith('d1', 'b', { amount_paid: 100000, balance: 0, status: 'paid' })
  })

  it('a server refusal is shown and nothing else is written', async () => {
    payments.recordCollection.mockRejectedValue(new Error('Supabase error (400): Nothing is outstanding on this sale'))
    await render()
    await click(buttons('Mark paid')[0])
    await click(buttons('Mark paid').at(-1))
    expect(debts.update).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Nothing is outstanding on this sale')
  })

  it('a manual debt is still marked paid in one click', async () => {
    await render()
    await click(buttons('Mark paid')[1])
    expect(debts.update).toHaveBeenCalledWith('d2', 'b', { amount_paid: 500, balance: 0, status: 'paid' })
    expect(payments.recordCollection).not.toHaveBeenCalled()
  })
})
