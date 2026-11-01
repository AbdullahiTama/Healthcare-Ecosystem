import { describe, it, expect } from 'vitest'
import { supplierKey, looseSupplierKey, toSupplier, matchSupplier } from './suppliers'

const suppliers = [
  { supplier_key: 'medsupply ltd', supplier_name: 'MedSupply Ltd', purchase_count: 4, total_spent: 52000, amount_paid: 40000, balance: 12000, last_date: '2026-10-30', last_total: 9000 },
  { supplier_key: 'emzor pharmaceuticals', supplier_name: 'Emzor Pharmaceuticals', purchase_count: 1, total_cost: 3000, amount_paid: 3000, balance: 0, last_purchase_at: '2026-09-01T10:00:00' },
  { supplier_key: 'fidson', supplier_name: 'Fidson', purchase_count: 2, total_spent: 8000, amount_paid: 8000, balance: 0, last_date: '2026-10-01' },
].map(toSupplier)

describe('supplier matching', () => {
  it('the key is the database\'s: case and surrounding spaces ignored', () => {
    expect(supplierKey('  MedSupply Ltd ')).toBe('medsupply ltd')
  })

  it('reads both supplier row shapes', () => {
    expect(suppliers[0]).toMatchObject({ key: 'medsupply ltd', totalSpent: 52000, balance: 12000, lastDate: '2026-10-30', lastTotal: 9000 })
    expect(suppliers[1]).toMatchObject({ totalSpent: 3000, lastDate: '2026-09-01', lastTotal: null })
  })

  it('an existing supplier typed in any case is that supplier', () => {
    const r = matchSupplier(suppliers, ' medsupply LTD')
    expect(r.exact?.name).toBe('MedSupply Ltd')
    expect(r.similar).toEqual([])
  })

  it('a near duplicate is flagged so it can be picked instead', () => {
    expect(looseSupplierKey('Medsupply Limited.')).toBe(looseSupplierKey('MedSupply Ltd'))
    expect(matchSupplier(suppliers, 'Medsupply Limited').similar.map((s) => s.name)).toEqual(['MedSupply Ltd'])
    expect(matchSupplier(suppliers, 'Emzor').similar.map((s) => s.name)).toEqual(['Emzor Pharmaceuticals'])
  })

  it('a genuinely new supplier has no match and no warning', () => {
    const r = matchSupplier(suppliers, 'Bond Chemicals')
    expect(r.exact).toBeNull()
    expect(r.similar).toEqual([])
    expect(r.matches).toEqual([])
  })

  it('suggestions while typing: matches first, then most recent', () => {
    expect(matchSupplier(suppliers, 'f').matches.map((s) => s.name)).toEqual(['Fidson'])
    expect(matchSupplier(suppliers, '').matches.map((s) => s.name)).toEqual(['MedSupply Ltd', 'Fidson', 'Emzor Pharmaceuticals'])
  })
})
