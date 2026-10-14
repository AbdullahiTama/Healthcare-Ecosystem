import { describe, it, expect, vi } from 'vitest'
// Phase 1: a submit must match the request its code was issued for. With no
// live draft the handler refuses BEFORE checkOtp, so a resumed or repurposed
// form forces a fresh code instead of burning this one.
const h = vi.hoisted(() => {
  const s = { initiateTransfer: vi.fn(), createTransferRecipient: vi.fn(), checkBalance: vi.fn(), resolveAccount: vi.fn(), paystackFetch: vi.fn(), rpcCalls: [], owned: true, auth: null, draftRow: null }
  const builderFor = (table) => {
    const b = {
      select: () => b, eq: () => b, or: () => b, in: () => b, is: () => b, gt: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => (table === 'businesses' ? { data: s.owned ? { id: 'biz-1' } : null } : table === 'withdrawal_drafts' ? { data: s.draftRow } : { data: null }),
    }
    return b
  }
  s.routes = {}
  s.client = { from: builderFor, rpc: async (n, a) => { s.rpcCalls.push([n, a]); const r = s.routes[n]; return typeof r === 'function' ? r(a) : r || { data: null } } }
  return s
})

vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: h.paystackFetch }))
vi.mock('../_lib/businessWithdrawalEffects.js', () => ({ applyBusinessWithdrawalResult: async () => {} }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) } }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: h.createTransferRecipient,
  initiateTransfer: h.initiateTransfer,
  checkBalance: h.checkBalance,
  resolveAccount: h.resolveAccount,
}))

import { hashPin } from '@care-ecosystem/shared-payments'
process.env.OTP_HMAC_SECRET = 'test-secret' // the withdrawal code check keys its hash with this
import handler from './initiate-business-withdrawal.js'
import { destinationFingerprint } from '@care-ecosystem/shared-payments'

const SALT = '00112233445566778899aabbccddeeff'
const body = { business_id: 'biz-1', amount: 500000, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Clinic Ltd', pin: '1234', otp: '123456' }
const req = { method: 'POST', body }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const calls = (n) => h.rpcCalls.filter(([name]) => name === n)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.owned = true
  h.draftRow = null
  h.auth = { business: { id: 'biz-1', email: 'b@example.com' }, user: { id: 'user-1', email: 'b@example.com', email_confirmed_at: '2026-01-01' } }
  h.routes.get_withdrawal_pin = { data: [{ pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }] }
  h.routes.verify_withdrawal_pin = { data: true }
  h.routes.verify_otp = { data: 'ok' }
  h.resolveAccount.mockReset().mockResolvedValue({ accountName: 'Clinic Ltd' })
})

const liveDraft = (overrides = {}) => ({
  id: 'd-1', amount: 500000,
  destination_fp: destinationFingerprint({ userId: 'user-1', savedId: undefined, bankCode: '058', accountNumber: '0123456789' }),
  ...overrides,
})

describe('initiate-business-withdrawal draft gate (Phase 1)', () => {
  it('refuses a submit with no live draft before checkOtp', async () => {
    const r = res()
    await handler(req, r)
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_mismatch' })
    expect(calls('verify_otp')).toHaveLength(0)
  })

  it('refuses a submit for another destination at the same amount, without burning the code or the draft', async () => {
    h.draftRow = liveDraft({ destination_fp: destinationFingerprint({ userId: 'user-1', savedId: undefined, bankCode: '058', accountNumber: '0999999999' }) })
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
    expect(calls('void_withdrawal_draft')[0][1]).toMatchObject({ p_user_id: 'user-1', p_reason: 'consumed' })
  })
})
