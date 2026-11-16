import { describe, it, expect } from 'vitest'
import { availableStock, limitQty, cartStockProblems, stockLimitMessage, cartStockMessage } from './stockLimit'

const amox = { id: 'a', name: 'Amoxicillin', cat: 'Rx', stock: 3 }
const service = { id: 's', name: 'Consultation', cat: 'Services', stock: 0 }

describe('stock limits at the POS', () => {
  it('available stock: services unlimited, negative and missing stock count as none', () => {
    expect(availableStock(amox)).toBe(3)
    expect(availableStock(service)).toBe(Infinity)
    expect(availableStock({ stock: -4 })).toBe(0)
    expect(availableStock({ stock: null })).toBe(0)
    expect(availableStock({ stock: 2.7 })).toBe(2)
  })

  it('cuts a request down to what is on hand and says so', () => {
    expect(limitQty(amox, 2)).toEqual({ qty: 2, available: 3, limited: false })
    expect(limitQty(amox, 3)).toEqual({ qty: 3, available: 3, limited: false })
    expect(limitQty(amox, 8)).toEqual({ qty: 3, available: 3, limited: true })
    expect(limitQty({ ...amox, stock: 0 }, 1)).toEqual({ qty: 0, available: 0, limited: true })
    expect(limitQty(service, 50).limited).toBe(false)
  })

  it('finds cart lines above the current catalogue stock, not the copy on the line', () => {
    const cart = [{ id: 'a', name: 'Amoxicillin', qty: 3, stock: 10 }, { id: 's', name: 'Consultation', qty: 4 }]
    const byId = new Map([['a', { ...amox, stock: 1 }], ['s', service]])
    expect(cartStockProblems(cart, byId)).toEqual([{ id: 'a', name: 'Amoxicillin', qty: 3, available: 1 }])
    expect(cartStockProblems(cart, new Map([['a', amox], ['s', service]]))).toEqual([])
  })

  it('messages name the product and the available quantity', () => {
    expect(stockLimitMessage('Amoxicillin', 3, 8)).toBe('Only 3 Amoxicillin in stock. You asked for 8, so the quantity is set to 3.')
    expect(stockLimitMessage('Amoxicillin', 3)).toBe('Only 3 Amoxicillin in stock. The sale already has all 3.')
    expect(stockLimitMessage('Amoxicillin', 0, 2)).toBe('Amoxicillin is out of stock.')
    expect(cartStockMessage([{ name: 'Amoxicillin', qty: 3, available: 1 }])).toMatch(/Amoxicillin \(3 in sale, 1 in stock\)/)
  })
})
