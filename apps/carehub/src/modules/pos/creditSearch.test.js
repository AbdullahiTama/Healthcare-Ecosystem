import { describe, it, expect } from 'vitest'
import { matchesCreditSearch, searchCreditSales } from './creditSearch.js'
import { validatePaymentAmount } from '../../lib/paymentRules.js'
import { paymentErrorMessage } from '../../lib/dbErrors.js'

const sales = [
  { id: 1, client_name: 'Mama Ngozi', txn_no: 'TXN-1001', balance: 4000, is_credit: true, created_at: '2026-10-01T10:00:00' },
  { id: 2, client_name: 'Obi Ada', txn_no: 'TXN-1002', balance: 500, is_credit: true, created_at: '2026-10-05T10:00:00' },
  { id: 3, client_name: null, txn_no: 'TXN-2001', balance: 1200.5, is_credit: true, created_at: '2026-10-03T10:00:00' },
  { id: 4, client_name: 'Paid Off', txn_no: 'TXN-3', balance: 0, is_credit: false, created_at: '2026-10-04T10:00:00' },
  { id: 5, client_name: 'Held', txn_no: 'TXN-4', balance: 100, is_credit: true, is_on_hold: true, created_at: '2026-10-04T10:00:00' },
]

describe('matchesCreditSearch', () => {
  it('finds by customer name in any order and case, and by transaction number with or without separators', () => {
    expect(matchesCreditSearch(sales[1], 'ada obi')).toBe(true)
    expect(matchesCreditSearch(sales[0], '  NGOZI ')).toBe(true)
    expect(matchesCreditSearch(sales[0], 'txn-1001')).toBe(true)
    expect(matchesCreditSearch(sales[0], 'txn1001')).toBe(true)
    expect(matchesCreditSearch(sales[0], '1001')).toBe(true)
    expect(matchesCreditSearch(sales[2], 'walk')).toBe(true)
    expect(matchesCreditSearch(sales[0], 'bisi')).toBe(false)
  })
})

describe('searchCreditSales', () => {
  it('lists only outstanding, not-held credit sales, with the total of what matches', () => {
    const r = searchCreditSales(sales)
    expect(r.results.map((s) => s.id)).toEqual([2, 3, 1])
    expect(r.totalOpen).toBe(3)
    expect(r.outstanding).toBe(5700.5)
    expect(searchCreditSales(sales, { query: 'ngozi' })).toMatchObject({ outstanding: 4000, totalOpen: 3 })
  })
  it('sorts by oldest, largest balance or name', () => {
    expect(searchCreditSales(sales, { sort: 'oldest' }).results.map((s) => s.id)).toEqual([1, 3, 2])
    expect(searchCreditSales(sales, { sort: 'balance' }).results.map((s) => s.id)).toEqual([1, 3, 2])
    expect(searchCreditSales(sales, { sort: 'name' }).results.map((s) => s.id)).toEqual([1, 2, 3])
  })
})

describe('validatePaymentAmount', () => {
  it('accepts a part or the whole balance, rounded to kobo', () => {
    expect(validatePaymentAmount('2,500', 4000)).toEqual({ amount: 2500 })
    expect(validatePaymentAmount('1200.499', 1200.5)).toEqual({ amount: 1200.5 })
    expect(validatePaymentAmount(4000, 4000)).toEqual({ amount: 4000 })
  })
  it('refuses empty, zero, negative, text and more than the balance', () => {
    expect(validatePaymentAmount('', 10).error).toMatch(/Enter the amount/)
    expect(validatePaymentAmount('0', 10).error).toMatch(/greater than zero/)
    expect(validatePaymentAmount('-5', 10).error).toMatch(/greater than zero/)
    expect(validatePaymentAmount('abc', 10).error).toMatch(/greater than zero/)
    expect(validatePaymentAmount('4000.01', 4000).error).toMatch(/more than the balance of 4,000.00/)
  })
})

describe('paymentErrorMessage', () => {
  it("shows the database's refusal sentence, the session message, and a retry message for anything else", () => {
    expect(paymentErrorMessage(new Error('Supabase error (400): The amount is more than the balance of 7,500.00.'))).toBe('The amount is more than the balance of 7,500.00.')
    expect(paymentErrorMessage(new Error('Supabase error (404): Sale not found.'))).toBe('Sale not found.')
    expect(paymentErrorMessage(new Error('Session expired. Please log in again.'))).toBe('Session expired. Please log in again.')
    expect(paymentErrorMessage(new Error('Supabase error (500): internal'))).toMatch(/couldn't record the payment/)
    expect(paymentErrorMessage(new TypeError('Failed to fetch'))).toMatch(/couldn't record the payment/)
  })
})
