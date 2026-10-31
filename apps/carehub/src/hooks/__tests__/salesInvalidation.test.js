import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateSalesFigures } from '../queries'

// Recording a sale used to refresh the dashboard and POS lists but not Sales &
// Accounts or Financial Reports, so for a while one screen showed a figure from
// before the sale and another from after it (financial consistency audit, F4).

describe('invalidateSalesFigures', () => {
  it('marks every sales and money query stale together, and nothing else', () => {
    const qc = new QueryClient()
    const keys = {
      open: ['sales', 'open', 'b1'],
      recent: ['sales', 'recent', 'b1', 50],
      payments: ['sales', 'payments', 's1'],
      report: ['salesReport', 'b1', 'from', 'to'],
      financial: ['reports', 'b1', 'month', '2026-10'],
      products: ['products', 'b1'],
    }
    for (const k of Object.values(keys)) qc.setQueryData(k, [])
    invalidateSalesFigures(qc)
    const stale = (k) => qc.getQueryState(k).isInvalidated
    expect(stale(keys.open)).toBe(true)
    expect(stale(keys.recent)).toBe(true)
    expect(stale(keys.payments)).toBe(true)
    expect(stale(keys.report)).toBe(true)
    expect(stale(keys.financial)).toBe(true)
    expect(stale(keys.products)).toBe(false)
  })
})
