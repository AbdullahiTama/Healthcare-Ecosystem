import { describe, it, expect } from 'vitest'
import { groupCreditAccounts, searchCreditAccounts, accountTransactions, visitOwed, creditExportRows } from './creditAccounts'

const CLIENTS = [
  { id: 'c1', full_name: 'Mama Ngozi', phone: '0803 111 2222' },
  { id: 'c2', full_name: 'Chi', phone: '' }, { id: 'c3', full_name: 'chi ', phone: '' },
]
const sale = (id, extra) => ({ id, txn_no: 'TXN-' + id, total: 1000, amount_paid: 0, balance: 1000, is_credit: true, status: 'completed', ...extra })
const SALES = [
  sale('1', { client_id: 'c1', client_name: 'Mama Ngozi', created_at: '2026-10-03', total: 5000, amount_paid: 1000, balance: 4000 }),
  sale('2', { client_id: 'c1', client_name: 'Mama Ngozi', created_at: '2026-10-01' }),
  sale('3', { client_id: null, client_name: '  mama  ngozi', created_at: '2026-10-05', total: 300, balance: 300 }), // unlinked, one client by that name
  sale('4', { client_id: null, client_name: 'Chi', created_at: '2026-10-02' }), // two clients share the name
  sale('5', { client_id: null, client_name: 'Walk-in', created_at: '2026-10-04' }),
  sale('6', { client_id: null, client_name: 'Walk-in', created_at: '2026-10-06' }),
  sale('7', { client_id: 'c1', client_name: 'Mama Ngozi', is_on_hold: true }), // held: not credit
  sale('8', { client_id: 'c1', client_name: 'Mama Ngozi', balance: 0, amount_paid: 1000 }), // paid
]

describe('credit accounts', () => {
  it('one account per customer: linked sales, and an unlinked sale matching exactly one client by name', () => {
    const accounts = groupCreditAccounts(SALES, CLIENTS)
    const ngozi = accounts.find((a) => a.key === 'c:c1')
    expect(ngozi).toMatchObject({ name: 'Mama Ngozi', phone: '0803 111 2222', visits: 3, total: 6300, paid: 1000, balance: 5300, unlinked: 1, oldest: '2026-10-01', latest: '2026-10-05' })
    expect(ngozi.sales.map((s) => s.id)).toEqual(['2', '1', '3']) // oldest first
    expect(accounts.find((a) => a.key === 'n:chi')).toMatchObject({ ambiguous: true, visits: 1, clientId: null })
    // Walk-ins with no name are never merged.
    expect(accounts.filter((a) => a.walkIn).map((a) => a.name)).toEqual(['Walk-in (TXN-5)', 'Walk-in (TXN-6)'])
    expect(accounts).toHaveLength(4)
  })

  it('the account balance is the sum of what each visit owes (total less paid, never negative)', () => {
    expect(visitOwed({ total: 1000, amount_paid: 1500 })).toBe(0)
    expect(visitOwed({ total: 1000.5, amount_paid: 0.2 })).toBe(1000.3)
    const [a] = groupCreditAccounts([sale('a', { client_id: 'c1', total: 0.1 }), sale('b', { client_id: 'c1', total: 0.2 })], CLIENTS)
    expect(a.balance).toBe(0.3)
  })

  it('searches name, phone and transaction numbers; sorts', () => {
    const accounts = groupCreditAccounts(SALES, CLIENTS)
    expect(searchCreditAccounts(accounts, { query: 'ngozi mama' }).results.map((a) => a.key)).toEqual(['c:c1'])
    expect(searchCreditAccounts(accounts, { query: '08031112222' }).results.map((a) => a.key)).toEqual(['c:c1'])
    expect(searchCreditAccounts(accounts, { query: 'txn3' }).results.map((a) => a.key)).toEqual(['c:c1'])
    const r = searchCreditAccounts(accounts, { sort: 'balance' })
    expect(r.results[0].key).toBe('c:c1')
    expect(r.outstanding).toBe(8300)
    expect(searchCreditAccounts(accounts, { sort: 'oldest' }).results[0].key).toBe('c:c1')
  })

  it('transactions list every purchase and payment with the balance after each, which ends at what is owed', () => {
    const sales = [sale('1', { created_at: '2026-10-01T09:00:00', total: 5000 }), sale('2', { created_at: '2026-10-03T09:00:00', total: 2000 })]
    const tx = accountTransactions(sales, [
      { sale_id: '1', kind: 'sale', amount: 1000, received_at: '2026-10-01T09:00:00' },
      { sale_id: '1', kind: 'collection', amount: 1500, received_at: '2026-10-02T09:00:00' },
      { sale_id: '2', kind: 'refund', amount: 100, received_at: '2026-10-04T09:00:00' },
      { sale_id: 'other', kind: 'collection', amount: 9, received_at: '2026-10-04T09:00:00' },
    ])
    expect(tx.map((e) => [e.type, e.amount, e.balance])).toEqual([['purchase', 5000, 5000], ['payment', 1000, 4000], ['payment', 1500, 2500], ['purchase', 2000, 4500], ['refund', 100, 4500]])
  })

  it('exports one row per account with its transaction numbers', () => {
    const rows = creditExportRows(groupCreditAccounts(SALES, CLIENTS).filter((a) => a.key === 'c:c1'))
    expect(rows[0]).toMatchObject({ name: 'Mama Ngozi', visits: 3, balance: 5300, oldest: '2026-10-01', transactions: 'TXN-2 (1000); TXN-1 (4000); TXN-3 (300)' })
  })
})
