import { describe, it, expect, vi } from 'vitest'

// Financial audit H-3: a plan payment settled by the shared Paystack webhook (the business closed the
// tab before the redirect) never ran computeCommission, so the agent earned nothing. This reconciler
// finds those payments and runs it.
const h = vi.hoisted(() => ({ computeCommission: vi.fn() }))
vi.mock('../_lib/commissions.js', () => ({ computeCommission: h.computeCommission }))

import { reconcileCommissions } from '../_lib/commissionReconcile.js'

function client({ referred = [], payments = [], commissions = [], flags = [] } = {}) {
  const tableRows = { businesses: referred, plan_payments: payments, commissions, commission_review_flags: flags }
  return {
    from: (table) => {
      const q = {
        select: () => q, in: () => q, not: () => q, gte: () => q, order: () => q,
        limit: async () => ({ data: tableRows[table], error: null }),
        then: (r) => r({ data: tableRows[table], error: null }),
      }
      return q
    },
  }
}

const pay = (id, extra = {}) => ({ id, business_id: 'biz-1', naira_amount: 10000, is_first_payment: false, created_at: '2026-09-30T00:00:00Z', ...extra })

describe('reconcileCommissions', () => {
  it('does nothing when no business has a referring agent', async () => {
    expect(await reconcileCommissions(client())).toEqual({ checked: 0, created: 0, flagged: 0, errors: 0 })
    expect(h.computeCommission).not.toHaveBeenCalled()
  })

  it('computes commission only for payments with neither a commission nor a review flag', async () => {
    h.computeCommission.mockReset()
    h.computeCommission.mockResolvedValue({ commission: { id: 'c' }, flag: null })
    const c = client({
      referred: [{ id: 'biz-1' }],
      payments: [pay('p1', { is_first_payment: true }), pay('p2'), pay('p3')],
      commissions: [{ payment_id: 'p2' }],
      flags: [{ payment_id: 'p3' }],
    })
    const summary = await reconcileCommissions(c)
    expect(summary).toEqual({ checked: 1, created: 1, flagged: 0, errors: 0 })
    expect(h.computeCommission).toHaveBeenCalledTimes(1)
    expect(h.computeCommission.mock.calls[0][1]).toEqual({ paymentId: 'p1', businessId: 'biz-1', nairaCharged: 10000, isFirstPayment: true })
  })

  it('counts review flags and isolates a failing payment', async () => {
    h.computeCommission.mockReset()
    h.computeCommission
      .mockResolvedValueOnce({ commission: null, flag: true })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ commission: { id: 'c' }, flag: null })
    const c = client({ referred: [{ id: 'biz-1' }], payments: [pay('p1'), pay('p2'), pay('p3')] })
    expect(await reconcileCommissions(c)).toEqual({ checked: 3, created: 1, flagged: 1, errors: 1 })
  })
})
