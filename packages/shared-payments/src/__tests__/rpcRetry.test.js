import { describe, it, expect, vi } from 'vitest'
import { rpcWithRetry, isTransientDbError } from '../rpcRetry.js'
import { settleByReference } from '../settlement.js'
import { settleRefund } from '../refunds.js'
import { createFakeSupabase, createFakeProvider, verifiedPayment } from '../testing.js'

const err = (code, message = 'x') => ({ data: null, error: { code, message } })
const noSleep = { sleep: async () => {}, random: () => 0.5 }

describe('isTransientDbError', () => {
  it.each(['40001', '40P01', '55P03', '57014', '53300', '57P01', '08006'])('treats SQLSTATE %s as infrastructure', (code) => {
    expect(isTransientDbError({ code, message: 'whatever' })).toBe(true)
  })
  it.each(['fetch failed', 'ECONNRESET', 'deadlock detected', '502 Bad Gateway', 'Service Unavailable', 'too many connections for role'])('treats "%s" as infrastructure', (message) => {
    expect(isTransientDbError({ message })).toBe(true)
  })
  it.each([['23505', 'duplicate key'], ['23514', 'check violation'], ['42501', 'permission denied'], ['P0001', 'amount mismatch'], ['22P02', 'bad input']])('never treats a business error (%s) as transient', (code, message) => {
    expect(isTransientDbError({ code, message })).toBe(false)
  })
  it('no error is not transient', () => { expect(isTransientDbError(null)).toBe(false) })
})

describe('rpcWithRetry', () => {
  it('returns the first success without retrying', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: { ok: 1 }, error: null })) }
    expect(await rpcWithRetry(supabase, 'f', { a: 1 }, noSleep)).toEqual({ data: { ok: 1 }, error: null })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('f', { a: 1 })
  })

  it('retries a deadlock and then returns the success', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValueOnce(err('40P01', 'deadlock detected')).mockResolvedValueOnce(err('55P03')).mockResolvedValueOnce({ data: 'ok', error: null }) }
    const logger = { warn: vi.fn() }
    expect(await rpcWithRetry(supabase, 'f', {}, { ...noSleep, logger })).toEqual({ data: 'ok', error: null })
    expect(supabase.rpc).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn.mock.calls[0][1]).toMatchObject({ rpc: 'f', attempt: 1, code: '40P01' })
  })

  it('gives up after the attempts and returns the last error (it does not throw)', async () => {
    const supabase = { rpc: vi.fn(async () => err('40001')) }
    const r = await rpcWithRetry(supabase, 'f', {}, { ...noSleep, attempts: 3 })
    expect(r.error.code).toBe('40001')
    expect(supabase.rpc).toHaveBeenCalledTimes(3)
  })

  it('never retries a business error', async () => {
    const supabase = { rpc: vi.fn(async () => err('23514', 'a withdrawal amount is immutable')) }
    const r = await rpcWithRetry(supabase, 'f', {}, noSleep)
    expect(r.error.code).toBe('23514')
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('a thrown network error is retried and, if it persists, comes back as an error result', async () => {
    const supabase = { rpc: vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce({ data: 1, error: null }) }
    expect(await rpcWithRetry(supabase, 'f', {}, noSleep)).toEqual({ data: 1, error: null })
    const dead = { rpc: vi.fn(async () => { throw new TypeError('fetch failed') }) }
    const r = await rpcWithRetry(dead, 'f', {}, noSleep)
    expect(r.error.message).toBe('fetch failed')
    expect(dead.rpc).toHaveBeenCalledTimes(3)
  })

  it('backs off with growing, jittered delays', async () => {
    const delays = []
    const supabase = { rpc: vi.fn(async () => err('40001')) }
    await rpcWithRetry(supabase, 'f', {}, { attempts: 4, baseDelayMs: 100, random: () => 0.5, sleep: async (ms) => { delays.push(ms) } })
    expect(delays).toEqual([100, 200, 400])
  })
})

describe('the engines use it', () => {
  it('settleByReference survives a deadlock inside settle_payment_intent (the payment is still settled, once)', async () => {
    let calls = 0
    const supabase = createFakeSupabase({
      tables: { payment_intents: [{ id: 'i1', reference: 'ref_00000001', status: 'pending', purpose: 'shop_order', expected_amount: 100000 }] },
      rpc: { settle_payment_intent: () => (++calls === 1 ? { data: null, error: { code: '40P01', message: 'deadlock detected' } } : { outcome: 'settled', purpose: 'shop_order' }) },
    })
    const provider = createFakeProvider({ verify: async () => verifiedPayment({ reference: 'ref_00000001', amountKobo: 100000 }) })
    const r = await settleByReference({ supabase, provider, reference: 'ref_00000001' })
    expect(r.outcome).toBe('settled')
    expect(calls).toBe(2)
  })

  it('settleByReference still reports a business refusal from the engine at once', async () => {
    const supabase = createFakeSupabase({
      tables: { payment_intents: [{ id: 'i1', reference: 'ref_00000001', status: 'pending', purpose: 'shop_order', expected_amount: 100000 }] },
      rpc: { settle_payment_intent: () => ({ data: null, error: { code: 'P0001', message: 'refused' } }) },
    })
    const provider = createFakeProvider({ verify: async () => verifiedPayment({ reference: 'ref_00000001', amountKobo: 100000 }) })
    await expect(settleByReference({ supabase, provider, reference: 'ref_00000001' })).rejects.toThrow(/refused/)
    expect(supabase.calls.filter((c) => c.name === 'settle_payment_intent')).toHaveLength(1)
  })

  it('settleRefund retries a lock timeout', async () => {
    let calls = 0
    const supabase = createFakeSupabase({ rpc: { settle_refund: () => (++calls === 1 ? { data: null, error: { code: '55P03', message: 'lock timeout' } } : { result: 'completed' }) } })
    expect(await settleRefund(supabase, { outcome: 'processed', id: 'rf1' })).toEqual({ result: 'completed' })
    expect(calls).toBe(2)
  })
})
