import { describe, it, expect } from 'vitest'
import { searchSales, matchesQuery, createSearchIndex, paymentMatches, looksLikeReceipt } from './transactionSearch'

const sale = (o) => ({ id: o.txn_no, total: 0, amount_paid: 0, balance: 0, discount: 0, payment_method: 'Cash', is_on_hold: false, created_at: '2026-10-27T09:30:00', items: JSON.stringify([]), ...o })
const sales = [
  sale({ txn_no: 'TXN-1001', client_name: 'Ada Okafor', total: 1500, amount_paid: 1500, items: JSON.stringify([{ name: 'Paracetamol 500mg', qty: 2, price: 750 }]) }),
  sale({ txn_no: 'TXN-1002', client_name: 'Bola Ade', total: 25000, amount_paid: 10000, balance: 15000, is_credit: true, payment_method: 'Credit', staff_name: 'Rep One', notes: 'pays friday' }),
  sale({ txn_no: 'TXN-1003', client_name: null, total: 480.5, amount_paid: 500, payment_method: 'Transfer', refunded_amount: 100, created_at: '2026-10-26T18:00:00' }),
]
const ids = (q) => searchSales(sales, q).map((s) => s.txn_no)

describe('transaction search (Sales & Accounts and Financial Reports)', () => {
  it('returns everything for an empty or blank query', () => {
    expect(ids('')).toHaveLength(3)
    expect(ids('   ')).toHaveLength(3)
    expect(ids(undefined)).toHaveLength(3)
  })
  it('finds by customer name, case-insensitively and partially', () => {
    expect(ids('ADA')).toEqual(['TXN-1001'])
    expect(ids('ade')).toEqual(['TXN-1002'])
    expect(ids('okafor')).toEqual(['TXN-1001'])
  })
  it('finds Walk-in sales that have no name', () => { expect(ids('walk')).toEqual(['TXN-1003']) })
  it('finds by receipt / invoice number', () => {
    expect(ids('1002')).toEqual(['TXN-1002'])
    expect(ids('txn-1003')).toEqual(['TXN-1003'])
  })
  it('finds by amount, with or without ₦ and commas', () => {
    expect(ids('₦25,000')).toEqual(['TXN-1002'])
    expect(ids('25000')).toEqual(['TXN-1002'])
    expect(ids('480.5')).toEqual(['TXN-1003'])
    expect(ids('15000')).toEqual(['TXN-1002']) // the balance owed
  })
  it('finds by product, payment method, cashier, note, status and date', () => {
    expect(ids('paracetamol')).toEqual(['TXN-1001'])
    expect(ids('transfer')).toEqual(['TXN-1003'])
    expect(ids('rep one')).toEqual(['TXN-1002'])
    expect(ids('friday')).toEqual(['TXN-1002'])
    expect(ids('part-paid')).toEqual(['TXN-1002'])
    expect(ids('credit')).toEqual(['TXN-1002'])
    expect(ids('refunded')).toEqual(['TXN-1003'])
    expect(ids('2026-10-26')).toEqual(['TXN-1003'])
  })
  it('requires every word to match', () => {
    expect(ids('ada 1500')).toEqual(['TXN-1001'])
    expect(ids('ada 25000')).toEqual([])
  })
  it('does not treat a short number as a match for unrelated text', () => {
    expect(matchesQuery(sales[0], '99999')).toBe(false)
  })
})

describe('search index', () => {
  it('finds the same sales as a one-off search, without re-reading items each time', () => {
    const index = createSearchIndex(sales)
    for (const q of ['ada', '25000', 'paracetamol', 'walk', 'ada 1500', '']) {
      expect(index.search(q).map((s) => s.txn_no)).toEqual(ids(q))
    }
  })
  it('checks one sale by id, for rows that point at a sale', () => {
    const index = createSearchIndex(sales)
    expect(index.matchesId('TXN-1002', 'bola')).toBe(true)
    expect(index.matchesId('TXN-1001', 'bola')).toBe(false)
    expect(index.matchesId('missing', 'bola')).toBe(false)
    expect(index.matchesId('missing', '')).toBe(true)
  })
})

describe('payments search', () => {
  const index = createSearchIndex(sales)
  const pay = { sale_id: 'TXN-1002', kind: 'collection', method: 'Transfer', amount: 5000, staff_name: 'Rep Two', note: '' }
  it('matches through its sale', () => { expect(paymentMatches(pay, index, 'bola')).toBe(true) })
  it('matches on its own method, receiver, kind and amount', () => {
    expect(paymentMatches({ ...pay, sale_id: 'x' }, index, 'transfer')).toBe(true)
    expect(paymentMatches({ ...pay, sale_id: 'x' }, index, 'rep two')).toBe(true)
    expect(paymentMatches({ ...pay, sale_id: 'x' }, index, 'repayment')).toBe(true)
    expect(paymentMatches({ ...pay, sale_id: 'x' }, index, '₦5,000')).toBe(true)
    expect(paymentMatches({ ...pay, sale_id: 'x' }, index, 'ada')).toBe(false)
  })
})

describe('receipt look-up across all dates', () => {
  it('is offered for a receipt-like query only', () => {
    expect(looksLikeReceipt('TXN-104154')).toBe(true)
    expect(looksLikeReceipt('104154')).toBe(true)
    expect(looksLikeReceipt('12')).toBe(false)
    expect(looksLikeReceipt('ada')).toBe(false)
    expect(looksLikeReceipt('ada 1500')).toBe(false)
  })
})
