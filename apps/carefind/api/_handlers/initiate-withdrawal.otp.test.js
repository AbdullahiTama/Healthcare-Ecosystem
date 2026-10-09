// E (withdrawal step-up): a user-initiated withdrawal must carry a fresh email OTP. The OTP is
// verified AFTER the PIN (the PIN stays the first factor) and BEFORE the account is resolved or
// anything is reserved, so a missing/incorrect code never reaches Paystack or the ledger.
const h = vi.hoisted(() => {
  const s = { rpcCalls: [], trust: { trust_level: 'trusted', device_trust_enabled: false } }
  const builder = () => {
    const b = {
      select: () => b, eq: () => b, is: () => b, order: () => b, limit: () => b, update: () => b,
      maybeSingle: async () => ({ data: { balance: 100 } }),
      then: (resolve) => resolve({ error: null }),
    }
    return b
  }
  s.client = {
    from: () => builder(),
    rpc: async (name, args) => {
      s.rpcCalls.push([name, args])
      if (name === 'get_withdrawal_trust') return { data: [s.trust] }
      if (name === 'get_withdrawal_pin') return { data: [{ pin_hash: 'h', pin_salt: 's' }] }
      if (name === 'verify_withdrawal_pin') return { data: true }
      if (name === 'create_withdrawal') return { data: { outcome: 'ok', id: 'w-1', reference: 'ref_1', payout_kobo: 9500 } }
      return { data: null }
    },
  }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => ({ id: 'user-12345678', email: 'u@example.com' }) }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/pinCrypto.js', () => ({ hashPin: () => 'h', verifyPin: vi.fn(() => true), isValidPin: () => true }))
vi.mock('../_lib/trustLevels.js', () => ({ getRequiredAuth: () => ['pin'], isInstantEligible: () => false, getDailyCap: () => 500 }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: vi.fn(async () => 'RCP_1'), initiateTransfer: vi.fn(async () => ({ transferCode: 'TRF_1' })),
  checkBalance: vi.fn(async () => 1_000_000_00),
  normalizeAccountName: (n) => String(n), resolveAccount: vi.fn(async () => ({ accountName: 'Ada Obi' })),
}))
vi.mock('../_lib/withdrawalRecovery.js', () => ({ reconcileWithdrawal: vi.fn() }))
vi.mock('../_lib/emailOtp.js', () => ({
  verifyWithdrawalOtp: vi.fn(async (_s, _u, code) =>
    (!code || typeof code !== 'string' || !/^\d{6}$/.test(code))
      ? { error: 'Enter the 6-digit code we emailed you', status: 400 }
      : { ok: true }),
}))

import handler from './initiate-withdrawal.js'
import { verifyWithdrawalOtp } from '../_lib/emailOtp.js'
import { verifyPin } from '../_lib/pinCrypto.js'
import { resolveAccount, initiateTransfer } from '../_lib/paystackTransfer.js'

function call(body) {
  const res = { statusCode: 0, body: null, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res)
}

const base = { amount: 10, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ada Obi', pin: '1234', otp: '123456' }
const created = () => h.rpcCalls.filter(([n]) => n === 'create_withdrawal')

beforeEach(() => {
  h.rpcCalls.length = 0
  verifyWithdrawalOtp.mockClear()
  verifyPin.mockClear().mockReturnValue(true)
  resolveAccount.mockClear().mockResolvedValue({ accountName: 'Ada Obi' })
  initiateTransfer.mockClear().mockResolvedValue({ transferCode: 'TRF_1' })
})

describe('initiate-withdrawal email OTP (second factor)', () => {
  it('refuses a withdrawal without an OTP before anything is reserved or resolved', async () => {
    const res = await call({ ...base, otp: undefined })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/6-digit code/)
    expect(created()).toHaveLength(0)
    expect(resolveAccount).not.toHaveBeenCalled()
  })

  it('surfaces a failed OTP verification and reserves nothing', async () => {
    verifyWithdrawalOtp.mockResolvedValueOnce({ error: 'Incorrect code', status: 403 })
    const res = await call({ ...base, otp: '000000' })
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('Incorrect code')
    expect(created()).toHaveLength(0)
    expect(initiateTransfer).not.toHaveBeenCalled()
  })

  it('verifies the OTP against the signed-in user with the submitted code', async () => {
    const res = await call(base)
    expect(verifyWithdrawalOtp).toHaveBeenCalledTimes(1)
    expect(verifyWithdrawalOtp).toHaveBeenCalledWith(expect.anything(), 'user-12345678', '123456')
    expect(res.statusCode).toBe(200)
    expect(created()).toHaveLength(1)
  })

  it('checks the PIN first: a wrong PIN is refused without the OTP ever being verified', async () => {
    verifyPin.mockReturnValue(false)
    const res = await call(base)
    expect(res.statusCode).toBe(403)
    expect(verifyWithdrawalOtp).not.toHaveBeenCalled()
    expect(created()).toHaveLength(0)
  })
})
