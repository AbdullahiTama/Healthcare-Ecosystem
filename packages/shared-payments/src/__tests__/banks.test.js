import { describe, it, expect, vi } from 'vitest'
import { fetchAllBanks, createBanksHandler, FALLBACK_NIGERIAN_BANKS } from '../banks.js'

const page = ({ banks, next, nextCursor }) => ({ status: true, message: 'OK', data: banks, meta: next ? { next: true, next_cursor: nextCursor } : { next: false } })
const res = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r }; r.json = (b) => { r.body = b; return r }; return r }

// Paystack's codes for the online banks, as /bank returns them; the NIBSS codes the old curated list used are not Paystack's.
const PAYSTACK_ONLINE_BANKS = [
  { code: '999992', name: 'OPay Digital Services Limited (OPay)', slug: 'paycom' },
  { code: '999991', name: 'PalmPay', slug: 'palmpay' },
  { code: '50211', name: 'Kuda Bank', slug: 'kuda-bank' },
  { code: '50515', name: 'Moniepoint MFB', slug: 'moniepoint-mfb' },
]

describe('fetchAllBanks', () => {
  it('serves Paystack\'s list as it is: every page, sorted, and no second OPay/PalmPay/Kuda with a code Paystack cannot resolve', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(page({ banks: [{ code: '057', name: 'Zenith Bank', slug: 'zenith-bank' }, ...PAYSTACK_ONLINE_BANKS.slice(0, 2)], next: true, nextCursor: 'abc' }))
      .mockResolvedValueOnce(page({ banks: [...PAYSTACK_ONLINE_BANKS.slice(2), { code: '044', name: 'Access Bank', slug: 'access-bank' }], next: false }))
    const banks = await fetchAllBanks(fetchFn)
    expect(fetchFn.mock.calls[0][0]).toContain('perPage=100')
    expect(fetchFn.mock.calls[1][0]).toContain('&cursor=abc')
    expect(banks.map((b) => b.code)).toEqual(['044', '50211', '50515', '999992', '999991', '057'])     // sorted by name
    expect(banks.filter((b) => /opay/i.test(b.name))).toEqual([{ code: '999992', name: 'OPay Digital Services Limited (OPay)', slug: 'paycom' }])
    for (const nibss of ['090405', '090410', '083']) expect(banks.some((b) => b.code === nibss)).toBe(false)
  })

  it('stops at the page cap and keeps one entry per code', async () => {
    const fetchFn = vi.fn().mockResolvedValue(page({ banks: [{ code: '001', name: 'Bank A' }], next: true, nextCursor: 'same' }))
    expect(await fetchAllBanks(fetchFn)).toHaveLength(1)
    expect(fetchFn).toHaveBeenCalledTimes(10)
  })

  it('fails loudly on a Paystack error or an empty list', async () => {
    await expect(fetchAllBanks(vi.fn().mockResolvedValue({ status: false, message: 'Invalid key' }))).rejects.toThrow('Paystack error')
    await expect(fetchAllBanks(vi.fn().mockResolvedValue(page({ banks: [], next: false })))).rejects.toThrow('no banks')
  })
})

describe('the fallback list', () => {
  it('uses Paystack\'s codes for the online banks, so a lookup still works when the live list cannot be loaded', () => {
    const code = (name) => FALLBACK_NIGERIAN_BANKS.find((b) => b.name === name)?.code
    expect(code('OPay')).toBe('999992')
    expect(code('PalmPay')).toBe('999991')
    expect(code('Kuda Bank')).toBe('50211')
    expect(code('Moniepoint MFB')).toBe('50515')
    expect(new Set(FALLBACK_NIGERIAN_BANKS.map((b) => b.code)).size).toBe(FALLBACK_NIGERIAN_BANKS.length)
  })
})

describe('createBanksHandler', () => {
  it('caches a good list, serves it when Paystack later fails, and falls back to the curated list before any success', async () => {
    let t = 0
    const fetchFn = vi.fn().mockResolvedValueOnce(page({ banks: PAYSTACK_ONLINE_BANKS, next: false })).mockRejectedValue(new Error('down'))
    const handler = createBanksHandler({ fetchFn, ttlMs: 1000, now: () => t, logger: { error: () => {} } })
    const first = res(); await handler({ method: 'GET' }, first)
    expect(first.body).toHaveLength(4)
    t = 5000
    const second = res(); await handler({ method: 'GET' }, second)
    expect(second.code).toBe(200); expect(second.body).toHaveLength(4)                    // the last good list
    const cold = createBanksHandler({ fetchFn: vi.fn().mockRejectedValue(new Error('down')), logger: { error: () => {} } })
    const third = res(); await cold({ method: 'GET' }, third)
    expect(third.body).toBe(FALLBACK_NIGERIAN_BANKS)
    const post = res(); await cold({ method: 'POST' }, post)
    expect(post.code).toBe(405)
  })
})
