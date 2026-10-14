import { describe, it, expect, vi } from 'vitest'
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', user_metadata: {} }) }))
// Phase 1: a submit must match the request its code was issued for. With no
// live draft the handler refuses BEFORE checkOtp, so a resumed or repurposed
// form forces a fresh code instead of burning this one.
const h = vi.hoisted(() => {
  const s = {
    initiateTransfer: vi.fn(),
    createTransferRecipient: vi.fn(),
    checkBalance: vi.fn(),
    paystackFetch: vi.fn(),
    rpcCalls: [],
    draftRow: null,
  }
  const builderFor = (table) => {
    const b = { select: () => b, eq: () => b, in: () => b, is: () => b, gt: () => b, order: () => b, limit: () => b, update: () => b, maybeSingle: async () => ({ data: table === 'withdrawal_drafts' ? s.draftRow : null }), then: (resolve) => resolve({ error: null }) }
    return b
  }
  s.routes = {}
  s.client = {
    from: (table) => builderFor(table),
    rpc: async (name, args) => { s.rpcCalls.push([name, args]); const r = s.routes[name]; return typeof r === 'function' ? r(args) : r || { data: null } },
  }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/financialConfig.js', () => ({ getFinancialConfig: async () => 20000 }))
vi.mock('../_lib/trustLevels.js', () => ({ getRequiredAuth: () => ['pin'], isInstantEligible: () => false, getDailyCap: () => 50 }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: h.createTransferRecipient,
  initiateTransfer: h.initiateTransfer,
  checkBalance: h.checkBalance,
  normalizeAccountName: (n) => String(n).trim().toLowerCase(),
  resolveAccount: async () => ({ accountName: 'Ada Obi' }),
}))

process.env.OTP_HMAC_SECRET = 'test-secret' // the withdrawal code check keys its hash with this
import handler from './initiate-withdrawal.js'
import { hashPin, randomPinSalt, destinationFingerprint } from '@care-ecosystem/shared-payments'

// The shared PIN gate (checkWithdrawalPin) compares against a real scrypt hash, so the stored row must be a real one.
const SALT = randomPinSalt()
const pinRow = (extra = {}) => ({ pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null, failed_attempts: 0, ...extra })

const req = { method: 'POST', body: { amount: 10, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ada Obi', pin: '1234', otp: '123456' } }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; r.setHeader = () => {}; return r }
const calls = (name) => h.rpcCalls.filter(([n]) => n === name)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.draftRow = null
  h.routes.get_withdrawal_trust = { data: { trust_level: 'new' } }
  h.routes.get_withdrawal_pin = { data: [pinRow()] }
  h.routes.verify_withdrawal_pin = { data: true }
  h.routes.verify_otp = { data: 'ok' }
})

const liveDraft = (overrides = {}) => ({
  id: 'd-1', amount: 10,
  destination_fp: destinationFingerprint({ userId: 'u-1', savedId: undefined, bankCode: '058', accountNumber: '0123456789' }),
  ...overrides,
})

describe('initiate-withdrawal draft gate (Phase 1)', () => {
  it('refuses a submit with no live draft before checkOtp', async () => {
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_mismatch' })
    expect(calls('verify_otp')).toHaveLength(0)
  })

  it('refuses a submit for another destination at the same amount, without burning the code or the draft', async () => {
    h.draftRow = liveDraft({ destination_fp: destinationFingerprint({ userId: 'u-1', savedId: undefined, bankCode: '058', accountNumber: '0999999999' }) })
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_mismatch' })
    expect(calls('verify_otp')).toHaveLength(0)
    expect(calls('void_withdrawal_draft')).toHaveLength(0)
  })

  it('a matching amount + destination passes the gate, then voids the consumed draft', async () => {
    h.draftRow = liveDraft()
    const r = res()
    await handler(req, r)
    expect(calls('verify_otp')).toHaveLength(1)
    expect(calls('void_withdrawal_draft')).toHaveLength(1)
    expect(calls('void_withdrawal_draft')[0][1]).toMatchObject({ p_user_id: 'u-1', p_reason: 'consumed' })
  })
})
