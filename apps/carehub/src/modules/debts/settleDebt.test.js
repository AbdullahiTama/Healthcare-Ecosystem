import { describe, it, expect, vi } from 'vitest'
import { settleDebt } from './settleDebt.js'

function fakes({ purchase = null, stillOpen = null } = {}) {
  return {
    debts: { update: vi.fn(async () => {}), findOpenBySource: vi.fn(async () => stillOpen) },
    purchases: { getById: vi.fn(async () => purchase), recordPayment: vi.fn(async () => ({ balance: 0 })) },
  }
}

describe('settleDebt', () => {
  it('a purchase debt is settled by paying the purchase\'s balance; a drifted debt is closed too', async () => {
    const f = fakes({ purchase: { id: 'p-1', balance: 700 }, stillOpen: { id: 'd2', amount: 900 } })
    const r = await settleDebt({ id: 'd2', source: 'purchase', source_ref: 'p-1', amount: 900 }, 'biz', { ...f, staffName: 'Ada' })
    expect(r).toEqual({ via: 'purchase' })
    expect(f.purchases.getById).toHaveBeenCalledWith('p-1', 'biz')
    expect(f.purchases.recordPayment).toHaveBeenCalledWith('p-1', { amount: 700, method: 'Other', note: 'Settled from the Debts page', staffName: 'Ada' })
    expect(f.debts.update).toHaveBeenCalledWith('d2', 'biz', { amount_paid: 900, balance: 0, status: 'paid' })
  })

  it('a purchase debt already in step is not touched again', async () => {
    const f = fakes({ purchase: { id: 'p-1', balance: 700 }, stillOpen: null })
    await settleDebt({ id: 'd2', source: 'purchase', source_ref: 'p-1', amount: 700 }, 'biz', f)
    expect(f.debts.update).not.toHaveBeenCalled()
  })

  it('a manual debt, or one whose purchase is already paid, is just marked paid', async () => {
    const f = fakes({ purchase: { id: 'p-1', balance: 0 } })
    expect(await settleDebt({ id: 'd3', source: 'manual', amount: 100 }, 'biz', f)).toEqual({ via: 'debt' })
    expect(await settleDebt({ id: 'd4', source: 'purchase', source_ref: 'p-1', amount: 50 }, 'biz', f)).toEqual({ via: 'debt' })
    expect(f.purchases.recordPayment).not.toHaveBeenCalled()
    expect(f.debts.update).toHaveBeenCalledWith('d3', 'biz', { amount_paid: 100, balance: 0, status: 'paid' })
  })

  it('before the supplier-payments update, a purchase debt is just marked paid, as it used to be', async () => {
    const f = fakes({ purchase: { id: 'p-1', balance: 700 } })
    f.purchases.recordPayment.mockRejectedValue(new Error('Supabase error (404): Could not find the function public.record_purchase_payment in the schema cache'))
    expect(await settleDebt({ id: 'd5', source: 'purchase', source_ref: 'p-1', amount: 700 }, 'biz', f)).toEqual({ via: 'debt' })
    expect(f.debts.update).toHaveBeenCalledWith('d5', 'biz', { amount_paid: 700, balance: 0, status: 'paid' })
  })
})
