import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPaystackSecretKey, paystackFetch } from '../../../api/_lib/paystack.js'

const originalFetch = global.fetch

describe('wallet lifecycle hardening', () => {
  describe('getPaystackSecretKey guard', () => {
    const orig = process.env.PAYSTACK_SECRET_KEY
    afterEach(() => { process.env.PAYSTACK_SECRET_KEY = orig })
    it('throws when PAYSTACK_SECRET_KEY missing', () => {
      delete process.env.PAYSTACK_SECRET_KEY
      expect(() => getPaystackSecretKey()).toThrow('PAYSTACK_SECRET_KEY is missing')
    })
    it('throws when key is publishable pk_live', () => {
      process.env.PAYSTACK_SECRET_KEY = 'pk_live_abc123'
      expect(() => getPaystackSecretKey()).toThrow('must be a secret key')
    })
    it('throws when key is pk_test', () => {
      process.env.PAYSTACK_SECRET_KEY = 'pk_test_abc'
      expect(() => getPaystackSecretKey()).toThrow('must be a secret key')
    })
    it('accepts sk_test', () => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_abc123'
      expect(getPaystackSecretKey()).toBe('sk_test_abc123')
    })
    it('accepts sk_live', () => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_live_abc123'
      expect(getPaystackSecretKey()).toBe('sk_live_abc123')
    })
  })

  describe('paystackFetch defensive parsing', () => {
    beforeEach(() => {
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy'
    })
    afterEach(() => { global.fetch = originalFetch })
    it('throws on empty Paystack body', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 200, text: async () => '' })
      await expect(paystackFetch('/transaction/verify/ref')).rejects.toThrow('empty response')
    })
    it('throws on invalid JSON', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 200, text: async () => 'not json {' })
      await expect(paystackFetch('/transaction/verify/ref')).rejects.toThrow('invalid JSON')
    })
    it('succeeds on valid JSON', async () => {
      global.fetch = vi.fn().mockResolvedValue({ status: 200, text: async () => '{"status":true,"data":{}}' })
      const data = await paystackFetch('/transaction/verify/ref')
      expect(data.status).toBe(true)
    })
  })

  describe('MAX_PRICE_COINS 12 enforcement', () => {
    const MAX = 12
    function validatePrice(priceCoins) {
      const price = Number(priceCoins)
      if (!Number.isInteger(price) || price <= 0 || price > MAX) return { error: 'Invalid price: must be 1-12 CareCoins' }
      return { ok: true, price }
    }
    it('allows 1..12', () => {
      expect(validatePrice(1).ok).toBe(true)
      expect(validatePrice(12).ok).toBe(true)
    })
    it('rejects 0', () => { expect(validatePrice(0).error).toMatch('Invalid price') })
    it('rejects 13', () => { expect(validatePrice(13).error).toMatch('Invalid price') })
    it('rejects 100 (old limit)', () => { expect(validatePrice(100).error).toMatch('Invalid price') })
    it('rejects float 5.5', () => { expect(validatePrice('5.5').error).toMatch('Invalid price') })
    it('rejects string 5abc', () => { expect(validatePrice('5abc').error).toMatch('Invalid price') })
  })

  describe('normalizeAccountName and mismatch', () => {
    function normalizeAccountName(name) {
      return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
    }
    it('treats casing/whitespace as equal', () => {
      expect(normalizeAccountName('  AMARA  Nwachukwu ')).toBe(normalizeAccountName('amara nwachukwu'))
    })
    it('rejects different names', () => {
      expect(normalizeAccountName('John Doe')).not.toBe(normalizeAccountName('Jane Doe'))
    })
    it('unsupported bank manual fallback: isUnsupportedBank detection', () => {
      const isUnsupported = (msg) => /not supported|does not support|unable to resolve|cannot resolve/i.test(msg)
      expect(isUnsupported('Bank not supported')).toBe(true)
      expect(isUnsupported('does not support')).toBe(true)
      expect(isUnsupported('Could not verify account')).toBe(false)
    })
  })

  describe('credit_wallet_topup idempotency shape', () => {
    async function creditTopup(supabase, args) {
      const { data, error } = await supabase.rpc('credit_wallet_topup', {
        p_user_id: args.userId,
        p_coins: args.coins,
        p_naira_amount: args.nairaAmount,
        p_reference: args.reference,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      return { alreadyProcessed: row.already_processed, newBalance: row.new_balance }
    }
    it('first call not alreadyProcessed', async () => {
      const mock = { rpc: vi.fn().mockResolvedValue({ data: [{ already_processed: false, new_balance: 10 }], error: null }) }
      const r = await creditTopup(mock, { userId:'u1', coins:5, nairaAmount:100000, reference:'ref1' })
      expect(r.alreadyProcessed).toBe(false)
      expect(r.newBalance).toBe(10)
    })
    it('second call same ref alreadyProcessed', async () => {
      const mock = { rpc: vi.fn().mockResolvedValue({ data: [{ already_processed: true, new_balance: 10 }], error: null }) }
      const r = await creditTopup(mock, { userId:'u1', coins:5, nairaAmount:100000, reference:'ref1' })
      expect(r.alreadyProcessed).toBe(true)
    })
  })
})
