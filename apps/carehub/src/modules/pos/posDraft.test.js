import { describe, it, expect } from 'vitest'
import { blankPosDraft, isPosDraftEmpty, normalizePosDraft, posDraftKey, heldSaleRef, customerRef } from './posDraft'

describe('posDraft', () => {
  it('a blank draft is an empty Walk-in cash sale', () => {
    expect(blankPosDraft()).toMatchObject({ cart: [], client: 'Walk-in', method: 'Cash', resumedSale: null, pickedClient: null })
    expect(isPosDraftEmpty(blankPosDraft())).toBe(true)
  })

  it('is worth keeping once it has a product, or a held sale open for editing', () => {
    expect(isPosDraftEmpty({ ...blankPosDraft(), cart: [{ id: 'p1', qty: 1, price: 10 }] })).toBe(false)
    expect(isPosDraftEmpty({ ...blankPosDraft(), resumedSale: { id: 'h1' } })).toBe(false)
    // a typed name or cash amount alone is not a sale in progress
    expect(isPosDraftEmpty({ ...blankPosDraft(), client: 'Ada', cash: '500' })).toBe(true)
    expect(isPosDraftEmpty(null)).toBe(true)
  })

  it('restores a well-formed draft exactly', () => {
    const d = {
      ...blankPosDraft(),
      cart: [{ id: 'p1', name: 'Amoxicillin', qty: 2, price: 1200, category: 'Drugs' }],
      client: 'Ada Obi', pickedClient: { id: 'c1', full_name: 'Ada Obi' }, method: 'Split', cash: '', disc: '10', discPct: true,
      splitAmounts: { Cash: '1000', Transfer: '1160', POS: '' }, creditAmountPaid: '', creditMethod: 'Transfer',
      holdNote: 'back soon', resumedSale: { id: 'h1', txn_no: 'HLD-1', notes: 'n' },
    }
    expect(normalizePosDraft(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })

  it('drops unusable cart lines and resets bad fields one by one, never the whole cart', () => {
    const d = normalizePosDraft({
      cart: [
        { id: 'p1', qty: 2, price: 100 },
        { id: 'p2', qty: 0, price: 100 },     // no quantity
        { id: 'p3', qty: 1.5, price: 100 },   // not a whole quantity
        { qty: 1, price: 100 },               // no product
        { id: 'p4', qty: 1, price: -5 },      // negative price
        { id: 'p5', qty: '3', price: '250' }, // numbers kept as strings by an older version
        null,
      ],
      method: 'Bitcoin', creditMethod: 'Cheque', discPct: 'yes', client: 42, splitAmounts: 'x', resumedSale: { txn_no: 'no id' },
    })
    expect(d.cart).toEqual([{ id: 'p1', qty: 2, price: 100 }, { id: 'p5', qty: 3, price: 250 }])
    expect(d).toMatchObject({ method: 'Cash', creditMethod: 'Cash', discPct: false, client: '42', splitAmounts: { Cash: '', Transfer: '', POS: '' }, resumedSale: null })
  })

  it('anything that is not a draft becomes a blank one', () => {
    for (const v of [null, undefined, 'cart', 7, []]) expect(normalizePosDraft(v)).toEqual(blankPosDraft())
  })

  it('keeps only the id and name of the customer, and the id, number and note of the held sale', () => {
    expect(customerRef({ id: 'c1', full_name: 'Ada', phone: '0803 111 2222', address: 'Ikeja' })).toEqual({ id: 'c1', full_name: 'Ada' })
    expect(customerRef(null)).toBeNull()
    expect(heldSaleRef({ id: 'h1', txn_no: 'HLD-1', notes: 'n', items: '[...]', total: 9 })).toEqual({ id: 'h1', txn_no: 'HLD-1', notes: 'n' })
    expect(heldSaleRef({ txn_no: 'x' })).toBeNull()
  })

  it('is kept per location and per staff member; owners share one key per location', () => {
    expect(posDraftKey('biz-1', 'staff-9')).toBe('pos_biz-1_staff-9')
    expect(posDraftKey('biz-1')).toBe('pos_biz-1_owner')
    expect(posDraftKey('biz-2')).not.toBe(posDraftKey('biz-1'))
    expect(posDraftKey(null, 'staff-9')).toBeNull()
  })
})
