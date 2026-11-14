import { describe, it, expect } from 'vitest'
import { debtTotals, matchesParty } from './debtTotals'

describe('debtTotals', () => {
  it('adds up the outstanding balance in each direction and counts the open debts', () => {
    const t = debtTotals([
      { direction: 'owes_us', balance: 1500 },
      { direction: 'owes_us', balance: '2500.50' },
      { direction: 'owes_us', balance: 0 },
      { direction: 'we_owe', balance: 4000 },
      { direction: 'we_owe', balance: -10 },
    ])
    expect(t).toEqual({ owedToUs: 4000.5, weOwe: 4000, outstanding: 8000.5, openOwedToUs: 2, openWeOwe: 1, count: 5 })
  })

  it('adds in whole kobo, so many small balances never drift', () => {
    const t = debtTotals(Array.from({ length: 10 }, () => ({ direction: 'owes_us', balance: 0.1 })))
    expect(t.owedToUs).toBe(1)
  })

  it('is zero for no debts', () => {
    expect(debtTotals([])).toEqual({ owedToUs: 0, weOwe: 0, outstanding: 0, openOwedToUs: 0, openWeOwe: 0, count: 0 })
  })
})

describe('matchesParty', () => {
  it('matches part of the name, ignoring case and extra spaces, and survives a missing name', () => {
    expect(matchesParty({ party_name: 'Musa  Bello' }, ' musa bel')).toBe(true)
    expect(matchesParty({ party_name: 'Ada' }, 'musa')).toBe(false)
    expect(matchesParty({ party_name: null }, 'musa')).toBe(false)
    expect(matchesParty({ party_name: null }, '')).toBe(true)
  })
})

describe('debtLedgerTotals', () => {
  it('adds amount, paid and outstanding in kobo, counts open debts, and flags figures that do not add up', async () => {
    const { debtLedgerTotals } = await import('./debtTotals')
    expect(debtLedgerTotals([
      { amount: 1000, amount_paid: 250.5, balance: 749.5 },
      { amount: 500, amount_paid: 500, balance: 0, status: 'paid' },
      { amount: 300, amount_paid: 0, balance: 200 },
    ])).toEqual({ amount: 1800, paid: 750.5, balance: 949.5, open: 2, count: 3, unreconciled: 1 })
  })
})
