// E (withdrawal step-up): a business withdrawal must carry a fresh email OTP. Verified AFTER the
// PIN (the PIN remains the first factor) and BEFORE the account is resolved or anything is
// reserved, so a missing/incorrect code never reaches Paystack or the ledger.
const h = vi.hoisted(() => {
  const s = { initiateTransfer: vi.fn(), createTransferRecipient: vi.fn(), checkBalance: vi.fn(), resolveAccount: vi.fn(), rpcCalls: [], owned: true, auth: null }
  const builderFor = () => {
    const b = {
      select: () => b, eq: () => b, or: () => b, in: () => b, is: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: { id: 'biz-1' } }),
    }
    return b
  }
  s.routes = {}
  s.client = { from: builderFor, rpc: async (n, a) => { s.rpcCalls.push([n, a]); const r = s.routes[n]; return typeof r === 'function' ? r(a) : r || { data: null } } }
  return s
})

vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))
vi.mock('../_lib/businessWithdrawalEffects.js', () => ({ applyBusinessWithdrawalResult: vi.fn() }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) } }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: h.createTransferRecipient,
  initiateTransfer: h.initiateTransfer,
  checkBalance: h.checkBalance,
  resolveAccount: h.resolveAccount,
}))
vi.mock('../_lib/emailOtp.js', () => ({
  verifyWithdrawalOtp: vi.fn(async (_s, _u, code) =>
    (!code || typeof code !== 'string' || !/^\d{6}$/.test(code))
      ? { error: 'Enter the 6-digit code we emailed you', status: 400 }
      : { ok: true }),
}))

import { hashPin } from '@care-ecosystem/shared-payments'
import handler from '../_handlers/initiate-business-withdrawal.js'
import { verifyWithdrawalOtp } from '../_lib/emailOtp.js'

const SALT = '00112233445566778899aabbccddeeff'
const body = { business_id: 'biz-1', amount: 500000, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Clinic Ltd', pin: '1234', otp: '123456' }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const calls = (n) => h.rpcCalls.filter(([name]) => name === n)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.owned = true
  h.auth = { business: { id: 'biz-1', email: 'b@example.com' }, user: { id: 'user-1', email: 'b@example.com', email_confirmed_at: '2026-01-01' } }
  h.routes.get_withdrawal_pin = { data: [{ pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }] }
  h.routes.verify_withdrawal_pin = { data: true }
  h.routes.create_business_withdrawal = { data: { outcome: 'ok', id: 'bw-1', reference: 'ch_wd_1', amount_kobo: 500000 } }
  h.routes.attach_business_withdrawal_transfer = { data: 'ok' }
  verifyWithdrawalOtp.mockClear()
  h.initiateTransfer.mockReset().mockResolvedValue({ transferCode: 'TRF_1' })
  h.createTransferRecipient.mockReset().mockResolvedValue('RCP_1')
  h.checkBalance.mockReset().mockResolvedValue(10_000_000_00)
  h.resolveAccount.mockReset().mockResolvedValue({ accountName: 'Clinic Ltd' })
})

describe('initiate-business-withdrawal email OTP (second factor)', () => {
  it('refuses a withdrawal without an OTP before anything is reserved or resolved', async () => {
    const r = res(); await handler({ method: 'POST', body: { ...body, otp: undefined } }, r)
    expect(r.statusCode).toBe(400)
    expect(r.body.error).toMatch(/6-digit code/)
    expect(calls('create_business_withdrawal')).toHaveLength(0)
    expect(h.resolveAccount).not.toHaveBeenCalled()
  })

  it('surfaces a failed OTP verification and reserves nothing', async () => {
    verifyWithdrawalOtp.mockResolvedValueOnce({ error: 'Incorrect code', status: 403 })
    const r = res(); await handler({ method: 'POST', body: { ...body, otp: '000000' } }, r)
    expect(r.statusCode).toBe(403)
    expect(r.body.error).toBe('Incorrect code')
    expect(calls('create_business_withdrawal')).toHaveLength(0)
    expect(h.initiateTransfer).not.toHaveBeenCalled()
  })

  it('verifies the OTP against the signed-in owner with the submitted code', async () => {
    const r = res(); await handler({ method: 'POST', body }, r)
    expect(verifyWithdrawalOtp).toHaveBeenCalledTimes(1)
    expect(verifyWithdrawalOtp).toHaveBeenCalledWith(expect.anything(), 'user-1', '123456')
    expect(r.statusCode).toBe(200)
    expect(calls('create_business_withdrawal')).toHaveLength(1)
  })

  it('checks the PIN first: a wrong PIN is refused without the OTP ever being verified', async () => {
    h.routes.verify_withdrawal_pin = { data: false }
    const r = res(); await handler({ method: 'POST', body }, r)
    expect(r.statusCode).toBe(403)
    expect(verifyWithdrawalOtp).not.toHaveBeenCalled()
    expect(calls('create_business_withdrawal')).toHaveLength(0)
  })
})
