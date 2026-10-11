import { describe, it, expect, vi } from 'vitest'
import { topupFee, getTopupFeeRate, DEFAULT_TOPUP_FEE_RATE } from '../topupFee.js'
import { resolveCallbackUrl, requestOrigin } from '../callbackUrl.js'

describe('topupFee: the fee is added on top, in integer kobo', () => {
  it('N200 coin -> N20 fee, N220 charged; every CareCoin package is exact', () => {
    expect(topupFee({ baseKobo: 20_000, rate: 0.1 })).toEqual({ baseKobo: 20_000, feeKobo: 2_000, totalKobo: 22_000, rate: 0.1 })
    for (const naira of [200, 950, 2700, 8500]) {
      const f = topupFee({ baseKobo: naira * 100, rate: 0.1 })
      expect(f.feeKobo).toBe(naira * 10)
      expect(Number.isInteger(f.feeKobo)).toBe(true)
      expect(f.totalKobo).toBe(f.baseKobo + f.feeKobo)
    }
  })

  it('rounds to the nearest kobo (half up) for amounts that do not divide evenly, and never returns a fraction', () => {
    expect(topupFee({ baseKobo: 15, rate: 0.1 }).feeKobo).toBe(2)   // 1.5 -> 2
    expect(topupFee({ baseKobo: 14, rate: 0.1 }).feeKobo).toBe(1)   // 1.4 -> 1
    expect(topupFee({ baseKobo: 10_000_000, rate: 0.1 }).totalKobo).toBe(11_000_000)
    for (const base of [1, 7, 33, 999, 123_457, 9_999_999]) expect(Number.isInteger(topupFee({ baseKobo: base, rate: 0.1 }).totalKobo)).toBe(true)
  })

  it('a zero rate is a valid "no fee"; nonsense is refused', () => {
    expect(topupFee({ baseKobo: 20_000, rate: 0 }).totalKobo).toBe(20_000)
    expect(() => topupFee({ baseKobo: 0, rate: 0.1 })).toThrow(RangeError)
    expect(() => topupFee({ baseKobo: 1.5, rate: 0.1 })).toThrow(RangeError)
    expect(() => topupFee({ baseKobo: 100, rate: 1.5 })).toThrow(RangeError)
    expect(() => topupFee({ baseKobo: 100, rate: -0.1 })).toThrow(RangeError)
    expect(() => topupFee({ baseKobo: 100, rate: '0.1' })).toThrow(RangeError)
  })
})

describe('getTopupFeeRate', () => {
  const db = (result) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) })
  const logger = () => ({ warn: vi.fn() })

  it('reads the configured rate', async () => {
    expect(await getTopupFeeRate(db({ data: { value: '0.15' }, error: null }))).toBe(0.15)
    expect(await getTopupFeeRate(db({ data: { value: 0 }, error: null }))).toBe(0)
  })

  it('a missing, unreadable or out-of-range row falls back to the 10% default and says so', async () => {
    for (const result of [{ data: null, error: null }, { data: null, error: { message: 'boom' } }, { data: { value: '2' }, error: null }, { data: { value: 'abc' }, error: null }]) {
      const l = logger()
      expect(await getTopupFeeRate(db(result), { logger: l })).toBe(DEFAULT_TOPUP_FEE_RATE)
      expect(l.warn).toHaveBeenCalledTimes(1)
      expect(JSON.parse(l.warn.mock.calls[0][0])).toMatchObject({ event: 'topup.fee_rate_unavailable', usingDefault: 0.1 })
    }
  })

  it('a client that throws is contained', async () => {
    const throwing = { from: () => { throw new Error('network') } }
    expect(await getTopupFeeRate(throwing, { logger: logger() })).toBe(0.1)
  })
})

describe('resolveCallbackUrl (F-27)', () => {
  const req = { headers: { host: 'carefind.app', 'x-forwarded-proto': 'https' } }
  const ok = (requested, extra = {}) => resolveCallbackUrl({ requested, req, allowedOrigins: [], ...extra })

  it('accepts a page on the app\'s own origin, keeping path and query', () => {
    const r = ok('https://carefind.app/wallet?topup=1')
    expect(r).toEqual({ ok: true, url: 'https://carefind.app/wallet?topup=1' })
  })

  it('accepts a listed extra origin (custom domain) and nothing else', () => {
    expect(ok('https://app.carefindhub.com/dashboard', { allowedOrigins: ['https://app.carefindhub.com'] }).ok).toBe(true)
    expect(ok('https://app.carefindhub.com/dashboard').ok).toBe(false)
  })

  it.each([
    ['another host', 'https://evil.example/wallet'],
    ['a look-alike prefix', 'https://carefind.app.evil.example/wallet'],
    ['a look-alike suffix', 'https://evilcarefind.app/wallet'],
    ['credentials in the URL', 'https://carefind.app@evil.example/wallet'],
    ['credentials on the real host', 'https://user:pw@carefind.app/wallet'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['protocol-relative', '//evil.example/wallet'],
    ['a relative path', '/wallet'],
    ['plain http on a real host', 'http://carefind.app/wallet'],
    ['a different port', 'https://carefind.app:8443/wallet'],
    ['empty', ''],
    ['not a string', 42],
    ['too long', `https://carefind.app/${'a'.repeat(3000)}`],
  ])('refuses %s', (_name, requested) => {
    expect(ok(requested).ok).toBe(false)
  })

  it('localhost may use http (development), with or without a port, but only for the request\'s own origin', () => {
    const dev = { headers: { host: 'localhost:5173' } }
    expect(resolveCallbackUrl({ requested: 'http://localhost:5173/wallet', req: dev, allowedOrigins: [] }).ok).toBe(true)
    expect(resolveCallbackUrl({ requested: 'http://localhost:9999/wallet', req: dev, allowedOrigins: [] }).ok).toBe(false)
  })

  it('reads PAYMENT_CALLBACK_ORIGINS from the environment and ignores junk entries', () => {
    process.env.PAYMENT_CALLBACK_ORIGINS = 'https://pay.example, not a url ,http://insecure.example'
    try {
      expect(resolveCallbackUrl({ requested: 'https://pay.example/ok', req }).ok).toBe(true)
      expect(resolveCallbackUrl({ requested: 'http://insecure.example/ok', req }).ok).toBe(false) // http on a real host is never accepted
    } finally {
      delete process.env.PAYMENT_CALLBACK_ORIGINS
    }
  })

  it('the request origin comes from the edge headers; forwarded host wins over host', () => {
    expect(requestOrigin({ headers: { host: 'internal', 'x-forwarded-host': 'carefind.app', 'x-forwarded-proto': 'https' } })).toBe('https://carefind.app')
    expect(requestOrigin({ headers: {} })).toBeNull()
    expect(requestOrigin({})).toBeNull()
  })
})
