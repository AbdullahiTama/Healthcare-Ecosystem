import { describe, it, expect, vi } from 'vitest'
import { settleDebt } from './settleDebt.js'

function fakes({ sale = null, purchase = null, stillOpen = null } = {}) {
  return {
    debts: { update: vi.fn(async () => {}), findOpenBySource: vi.fn(async () => stillOpen) },
    sales: { getById: vi.fn(async () => sale), recordPayment: vi.fn(async () => ({ balance: 0 })) },
    purchases: { getById: vi.fn(async () => purchase), recordPayment: vi.fn(async () => ({ balance: 0 })) },
  }
}

describe('settleDebt', () => {
  it('a credit-sale debt is settled by paying the sale\'s balance (history + sale + debt together)', async () => {
    const f = fakes({ sale: { id: 's-1', balance: 2500 } })
    const r = await settleDebt({ id: 'd1', source: 'credit_sale', source_ref: 'TXN-9', amount: 5000 }, 'biz', { ...f, staffName: 'Ada' })
    expect(r).toEqual({ via: 'sale' })
    expect(f.sales.getById).toHaveBeenCalledWith('biz', 'TXN-9')
    expect(f.sales.recordPayment).toHaveBeenCalledWith('s-1', { amount: 2500, method: 'Other', note: 'Settled from the Debts page', staffName: 'Ada' })
    expect(f.debts.update).not.toHaveBeenCalled()
  })

  it('a purchase debt is settled by paying the purchase\'s balance; a drifted debt is closed too', async () => {
    const f = fakes({ purchase: { id: 'p-1', balance: 700 }, stillOpen: { id: 'd2', amount: 900 } })
    const r = await settleDebt({ id: 'd2', source: 'purchase', source_ref: 'p-1', amount: 900 }, 'biz', f)
    expect(r).toEqual({ via: 'purchase' })
    expect(f.purchases.recordPayment).toHaveBeenCalledWith('p-1', expect.objectContaining({ amount: 700 }))
    expect(f.debts.update).toHaveBeenCalledWith('d2', 'biz', { amount_paid: 900, balance: 0, status: 'paid' })
  })

  it('a manual debt, or one whose sale is already settled, is just marked paid', async () => {
    const f = fakes({ sale: { id: 's-1', balance: 0 } })
    expect(await settleDebt({ id: 'd3', source: 'manual', amount: 100 }, 'biz', f)).toEqual({ via: 'debt' })
    expect(await settleDebt({ id: 'd4', source: 'credit_sale', source_ref: 'TXN-1', amount: 50 }, 'biz', f)).toEqual({ via: 'debt' })
    expect(f.sales.recordPayment).not.toHaveBeenCalled()
    expect(f.debts.update).toHaveBeenCalledWith('d3', 'biz', { amount_paid: 100, balance: 0, status: 'paid' })
  })
})
