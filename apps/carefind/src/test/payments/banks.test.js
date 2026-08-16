import { describe, it, expect, vi } from 'vitest'
import { fetchAllBanks, MAJOR_NIGERIAN_BANKS } from '../../../api/_handlers/banks.js'

function bankPage({ banks, next, nextCursor }) {
  return {
    status: true,
    message: 'OK',
    data: banks,
    meta: next ? { next: true, next_cursor: nextCursor } : { next: false },
  }
}

describe('fetchAllBanks cursor pagination', () => {
  it('aggregates multiple pages into one list and follows the cursor, merging with curated major banks', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(bankPage({
        banks: [{ code: '001', name: 'Bank A', slug: 'bank-a' }, { code: '002', name: 'Bank B', slug: 'bank-b' }],
        next: true, nextCursor: 'abc123',
      }))
      .mockResolvedValueOnce(bankPage({
        banks: [{ code: '003', name: 'Bank C', slug: 'bank-c' }],
        next: false,
      }))

    const banks = await fetchAllBanks(fetchFn)

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[0][0]).toContain('perPage=100')
    expect(fetchFn.mock.calls[0][0]).not.toContain('&cursor=')
    expect(fetchFn.mock.calls[1][0]).toContain('&cursor=abc123')
    // Curated (28) + 3 mock = 31
    expect(banks.length).toBe(31)
    // Curated major banks should be present
    expect(banks.some(b => b.code === '057' && b.name === 'Zenith Bank')).toBe(true)
    expect(banks.some(b => b.code === '033' && b.name === 'United Bank for Africa')).toBe(true)
    expect(banks.some(b => b.code === '090405' && b.name === 'OPay')).toBe(true)
    expect(banks.some(b => b.code === '090410' && b.name === 'PalmPay')).toBe(true)
    // Mock banks should also be included
    expect(banks.some(b => b.code === '001' && b.name === 'Bank A')).toBe(true)
    expect(banks.some(b => b.code === '002' && b.name === 'Bank B')).toBe(true)
    expect(banks.some(b => b.code === '003' && b.name === 'Bank C')).toBe(true)
  })

  it('handles a single page with no cursor, merging with curated major banks', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(bankPage({
      banks: [{ code: '001', name: 'Bank A', slug: 'bank-a' }],
      next: false,
    }))
    const banks = await fetchAllBanks(fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    // Curated (28) + 1 mock = 29
    expect(banks.length).toBe(29)
    expect(banks.some(b => b.code === '001' && b.name === 'Bank A')).toBe(true)
    expect(banks.some(b => b.code === '057' && b.name === 'Zenith Bank')).toBe(true)
  })

  it('stops at the safety cap instead of looping forever', async () => {
    const fetchFn = vi.fn().mockResolvedValue(bankPage({
      banks: [{ code: '001', name: 'Bank A', slug: 'bank-a' }],
      next: true, nextCursor: 'same-cursor-forever',
    }))
    const banks = await fetchAllBanks(fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(10)
    // 10 calls * 1 bank each = 10 from Paystack, but deduplicated with curated
    // The mock returns the same bank 10 times, so only 1 unique mock bank + 28 curated = 29
    expect(banks.length).toBe(29)
  })

  it('throws loudly when Paystack reports a failure', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ status: false, message: 'Invalid key' })
    await expect(fetchAllBanks(fetchFn)).rejects.toThrow('Paystack error')
  })
})