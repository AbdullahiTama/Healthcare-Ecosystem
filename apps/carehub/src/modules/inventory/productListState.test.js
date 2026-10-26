import { describe, it, expect } from 'vitest'
import { toRows, upsertProducts, removeProducts } from './productListState.js'

const list = [
  { id: 'a', name: 'Amoxicillin', stock: 4, price: 100 },
  { id: 'c', name: 'Ibuprofen', stock: 0, price: 50 },
  { id: 'b', name: 'Paracetamol', stock: 10, price: 30 },
]

describe('toRows', () => {
  it('accepts an array, a single row or nothing, and drops rows without an id', () => {
    expect(toRows([{ id: 1 }, { name: 'x' }, null])).toEqual([{ id: 1 }])
    expect(toRows({ id: 2 })).toEqual([{ id: 2 }])
    expect(toRows(null)).toEqual([])
    expect(toRows(undefined)).toEqual([])
  })
})

describe('upsertProducts', () => {
  it('replaces an edited row in place without touching the others', () => {
    const next = upsertProducts(list, { id: 'c', name: 'Ibuprofen', stock: 25, price: 55 })
    expect(next).not.toBe(list)
    expect(next.map((p) => p.id)).toEqual(['a', 'c', 'b'])
    expect(next[1]).toEqual({ id: 'c', name: 'Ibuprofen', stock: 25, price: 55 })
    expect(next[0]).toBe(list[0])
    expect(list[1].stock).toBe(0) // input not mutated
  })

  it('merges a partial row (restock returns only the new stock)', () => {
    const next = upsertProducts(list, { id: 'b', stock: 40 })
    expect(next[2]).toEqual({ id: 'b', name: 'Paracetamol', stock: 40, price: 30 })
  })

  it('inserts new rows in name order', () => {
    const next = upsertProducts(list, [{ id: 'z', name: 'Zinc' }, { id: 'd', name: 'Calamine' }])
    expect(next.map((p) => p.name)).toEqual(['Amoxicillin', 'Calamine', 'Ibuprofen', 'Paracetamol', 'Zinc'])
  })

  it('matches ids whether they arrive as numbers or strings', () => {
    const numeric = [{ id: 7, name: 'Vitamin C', stock: 1 }]
    expect(upsertProducts(numeric, { id: '7', stock: 9 })).toEqual([{ id: '7', name: 'Vitamin C', stock: 9 }])
  })

  it('returns the same list when the server sent nothing usable', () => {
    expect(upsertProducts(list, [])).toBe(list)
    expect(upsertProducts(list, null)).toBe(list)
  })
})

describe('removeProducts', () => {
  it('removes the given ids only', () => {
    expect(removeProducts(list, ['a', 'b']).map((p) => p.id)).toEqual(['c'])
  })

  it('returns the same list for an empty id list', () => {
    expect(removeProducts(list, [])).toBe(list)
  })
})
