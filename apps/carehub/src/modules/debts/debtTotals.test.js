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
    expect(t).toEqual({ owedToUs: 4000.5, weOwe: 4000, openOwedToUs: 2, openWeOwe: 1, count: 5 })
  })

  it('is zero for no debts', () => {
    expect(debtTotals([])).toEqual({ owedToUs: 0, weOwe: 0, openOwedToUs: 0, openWeOwe: 0, count: 0 })
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
