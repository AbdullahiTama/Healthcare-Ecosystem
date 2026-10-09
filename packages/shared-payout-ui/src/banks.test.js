import { describe, it, expect } from 'vitest'
import { rankBanks, searchBanks, isValidAccountNumber } from './banks.js'

const live = [
  { code: '044', name: 'Access Bank', slug: 'access-bank' },
  { code: '063', name: 'Access Bank (Diamond)', slug: 'access-bank-diamond' },
  { code: '035', name: 'Wema Bank', slug: 'wema-bank' },
  { code: '035A', name: 'ALAT by WEMA', slug: 'alat-by-wema' },
  { code: '058', name: 'Guaranty Trust Bank', slug: 'gtb' },
  { code: '033', name: 'United Bank For Africa', slug: 'uba' },
  { code: '057', name: 'Zenith Bank', slug: 'zenith' },
  { code: '232', name: 'Sterling Bank', slug: 'sterling' },
  { code: '301', name: 'Jaiz Bank', slug: 'jaiz' },
  { code: '999992', name: 'OPay Digital Services Limited (OPay)', slug: 'opay' },
  { code: '999991', name: 'PalmPay Limited', slug: 'palmpay' },
  { code: '50515', name: 'Moniepoint Microfinance Bank', slug: 'moniepoint' },
  { code: '999', name: 'Zebra Bank', slug: 'zebra' },
  { code: '001', name: 'Alpha Bank', slug: 'alpha' },
]

describe('rankBanks', () => {
  it('puts the requested popular banks first, in display order, with codes taken from the provider', () => {
    const ranked = rankBanks(live)
    const popular = ranked.filter((b) => b.popular).map((b) => b.name)
    expect(popular).toEqual([
      'Access Bank', 'Guaranty Trust Bank', 'United Bank For Africa', 'Zenith Bank', 'Sterling Bank',
      'Wema Bank', 'Jaiz Bank', 'OPay Digital Services Limited (OPay)', 'PalmPay Limited',
      'Moniepoint Microfinance Bank',
    ])
    expect(ranked.find((b) => b.slug === 'opay').code).toBe('999992')
    expect(ranked.slice(0, popular.length).every((b) => b.popular)).toBe(true)
  })

  it('does not treat the Diamond variant as the main Access Bank, and keeps WEMA and ALAT as two banks', () => {
    const ranked = rankBanks(live)
    expect(ranked.find((b) => b.code === '044').popular).toBe(true)
    expect(ranked.find((b) => b.code === '063').popular).toBe(false)
    expect(ranked.filter((b) => b.code.startsWith('035'))).toHaveLength(2)
  })

  it('sorts the remaining banks A-Z', () => {
    const rest = rankBanks(live).filter((b) => !b.popular).map((b) => b.name)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
  })

  it('keeps one entry per code and drops malformed rows', () => {
    const ranked = rankBanks([{ code: '1', name: 'A' }, { code: '1', name: 'Dup' }, { name: 'No code' }, null, { code: '2' }])
    expect(ranked.map((b) => b.code)).toEqual(['1'])
    expect(ranked[0].name).toBe('A')
  })

  it('tolerates empty input and does not mutate it', () => {
    expect(rankBanks(undefined)).toEqual([])
    const input = [{ code: '2', name: 'B' }, { code: '1', name: 'A' }]
    const copy = JSON.parse(JSON.stringify(input))
    rankBanks(input)
    expect(input).toEqual(copy)
  })
})

describe('searchBanks', () => {
  const banks = rankBanks(live)
  it('matches partial, case-insensitive names', () => {
    expect(searchBanks(banks, 'MONIE').map((b) => b.name)).toEqual(['Moniepoint Microfinance Bank'])
    expect(searchBanks(banks, 'pay').map((b) => b.code)).toContain('999991')
  })
  it('requires every token to match', () => {
    expect(searchBanks(banks, 'trust bank')).toHaveLength(1)
    expect(searchBanks(banks, 'trust zenith')).toHaveLength(0)
  })
  it('returns everything for a blank query', () => {
    expect(searchBanks(banks, '  ')).toBe(banks)
  })
})

describe('isValidAccountNumber', () => {
  it('requires exactly 10 digits', () => {
    expect(isValidAccountNumber('0123456789')).toBe(true)
    expect(isValidAccountNumber('012345678')).toBe(false)
    expect(isValidAccountNumber('01234567890')).toBe(false)
    expect(isValidAccountNumber('012345678a')).toBe(false)
    expect(isValidAccountNumber(123456789)).toBe(false)
  })
})
