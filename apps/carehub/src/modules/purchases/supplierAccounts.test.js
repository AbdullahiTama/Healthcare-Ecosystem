import { describe, it, expect } from 'vitest'
import { toAccount, accountTotals, filterAccounts, groupSupplierPayments } from './supplierAccounts'

const rows = [
  { supplier_key: 'emzor ltd', supplier_name: 'Emzor Ltd', purchase_count: 2, supply_count: 1, supplied_total: '21000', paid_total: '1000', balance: '20000', open_count: 3, mismatch_count: 0, last_supply_at: '2026-03-05T10:00:00' },
  { supplier_key: 'fidson', supplier_name: 'Fidson', purchase_count: 1, supply_count: 0, supplied_total: 2000.1, paid_total: 2000.1, balance: 0, open_count: 0, mismatch_count: 1, last_supply_at: '2026-03-06' },
]

describe('supplier accounts', () => {
  it('reads account rows and totals them in kobo; supplied = paid + outstanding', () => {
    const a = rows.map(toAccount)
    expect(a[0]).toEqual({ key: 'emzor ltd', name: 'Emzor Ltd', purchases: 2, supplies: 1, supplied: 21000, paid: 1000, balance: 20000, open: 3, mismatches: 0, lastSupply: '2026-03-05' })
    expect(accountTotals(a)).toEqual({ supplied: 23000.1, paid: 3000.1, balance: 20000, mismatches: 1, owing: 1, count: 2 })
  })

  it('searches every word in any order, sorts, and can show only suppliers owed', () => {
    const a = rows.map(toAccount)
    expect(filterAccounts(a, { query: 'ltd emzor' }).map((x) => x.name)).toEqual(['Emzor Ltd'])
    expect(filterAccounts(a, { sort: 'name' }).map((x) => x.name)).toEqual(['Emzor Ltd', 'Fidson'])
    expect(filterAccounts(a, { sort: 'recent' }).map((x) => x.name)).toEqual(['Fidson', 'Emzor Ltd'])
    expect(filterAccounts(a, { owingOnly: true }).map((x) => x.name)).toEqual(['Emzor Ltd'])
  })

  it('one supplier payment spread over several items reads as one payment, with its parts', () => {
    const g = groupSupplierPayments([
      { id: 'a', amount: 10000, allocation_id: 'x', balance_after: 0, note: 'March cheque' },
      { id: 'b', amount: 2500, allocation_id: 'x', balance_after: 4500 },
      { id: 'c', amount: 1000, balance_after: 3000 },
    ])
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ id: 'alloc-x', amount: 12500, note: 'March cheque', balance_after: undefined })
    expect(g[0].parts.map((p) => p.id)).toEqual(['a', 'b'])
    expect(g[1].id).toBe('c')
  })
})
