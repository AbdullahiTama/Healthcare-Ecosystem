import { describe, it, expect, vi } from 'vitest'
import { fetchAllBanks } from '../../../api/_handlers/banks.js'

function bankPage({ banks, next, nextCursor }) {
  return {
    status: true,
    message: 'OK',
    data: banks,
    meta: next ? { next: true, next_cursor: nextCursor } : { next: false },
  }
}

describe('fetchAllBanks cursor pagination', () => {
  it('aggregates multiple pages into one list and follows the cursor', async () => {
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
    expect(banks).toEqual([
      { code: '001', name: 'Bank A', slug: 'bank-a' },
      { code: '002', name: 'Bank B', slug: 'bank-b' },
      { code: '003', name: 'Bank C', slug: 'bank-c' },
    ])
  })

  it('handles a single page with no cursor', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(bankPage({
      banks: [{ code: '001', name: 'Bank A', slug: 'bank-a' }],
      next: false,
    }))
    const banks = await fetchAllBanks(fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(banks).toEqual([{ code: '001', name: 'Bank A', slug: 'bank-a' }])
  })

  it('stops at the safety cap instead of looping forever', async () => {
    const fetchFn = vi.fn().mockResolvedValue(bankPage({
      banks: [{ code: '001', name: 'Bank A', slug: 'bank-a' }],
      next: true, nextCursor: 'same-cursor-forever',
    }))
    const banks = await fetchAllBanks(fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(10)
    expect(banks.length).toBe(10)
  })

  it('throws loudly when Paystack reports a failure', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({ status: false, message: 'Invalid key' })
    await expect(fetchAllBanks(fetchFn)).rejects.toThrow('Paystack error')
  })
})