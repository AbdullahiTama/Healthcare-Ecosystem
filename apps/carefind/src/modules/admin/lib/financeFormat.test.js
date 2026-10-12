import { describe, it, expect } from 'vitest'
import { topupTotal, countByType, nairaFromCoins, maskAccount, isInFlight } from './financeFormat'

const tx = [
  { id: 1, type: 'topup', naira_amount: 250000, status: 'completed' },
  { id: 2, type: 'topup', naira_amount: 50000, status: 'failed' },
  { id: 3, type: 'topup', naira_amount: null, status: 'pending' },
  { id: 4, type: 'withdrawal', naira_amount: 999999, status: 'completed' },
]

describe('financeFormat (legacy maths)', () => {
  it('topupTotal sums naira_amount of top-ups only, divides by 100, and ignores status', () => {
    expect(topupTotal(tx)).toBe(3000)
  })
  it('topupTotal of nothing is 0', () => expect(topupTotal([])).toBe(0))
  it('countByType counts rows of that type', () => {
    expect(countByType(tx, 'topup')).toBe(3)
    expect(countByType(tx, 'withdrawal')).toBe(1)
    expect(countByType(tx, 'refund')).toBe(0)
  })
  it('nairaFromCoins is amount * 200', () => {
    expect(nairaFromCoins(12)).toBe(2400)
    expect(nairaFromCoins(0)).toBe(0)
  })
  it('maskAccount keeps only the last four digits', () => {
    expect(maskAccount('0123456789')).toBe('••••6789')
    expect(maskAccount('1234')).toBe('••••1234')
  })
  it('maskAccount shows a dash when there is nothing sensible to mask', () => {
    expect(maskAccount(undefined)).toBe('—')
    expect(maskAccount('')).toBe('—')
    expect(maskAccount('12')).toBe('—')
  })
  it('isInFlight is reserved or processing only', () => {
    expect(isInFlight({ status: 'reserved' })).toBe(true)
    expect(isInFlight({ status: 'processing' })).toBe(true)
    expect(isInFlight({ status: 'completed' })).toBe(false)
    expect(isInFlight({ status: 'pending' })).toBe(false)
  })
})
