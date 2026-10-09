// Milestone D1: when the reservation reports untraceable credits the handler must refuse with a
// clear message, email the user once via wallet_needs_attention, and never touch Paystack.
const h = vi.hoisted(() => {
  const s = {
    rpcCalls: [],
    trust: { trust_level: 'trusted', device_trust_enabled: false },
    created: { outcome: 'untraceable_credits', withdrawable_coins: 10, untraceable_coins: 5 },
  }
  const builder = () => {
    const b = {
      select: () => b, eq: () => b, is: () => b, order: () => b, limit: () => b, update: () => b,
      maybeSingle: async () => ({ data: { balance: 150 } }),
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
      if (name === 'create_withdrawal') return { data: s.created }
      return { data: null }
    },
  }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => ({ id: 'user-12345678', email: 'u@example.com', user_metadata: { full_name: 'Ada Obi' } }) }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/pinCrypto.js', () => ({ hashPin: () => 'h', verifyPin: () => true, isValidPin: () => true }))
vi.mock('../_lib/trustLevels.js', () => ({ getRequiredAuth: () => ['pin'], isInstantEligible: () => false, getDailyCap: () => 500 }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: vi.fn(), initiateTransfer: vi.fn(), checkBalance: vi.fn(),
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
import { enqueue, processBatch } from '../_lib/emailService.js'
import { checkBalance, createTransferRecipient, initiateTransfer } from '../_lib/paystackTransfer.js'

function call(body) {
  const res = { statusCode: 0, body: null, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res)
}

const base = { amount: 15, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ada Obi', pin: '1234', otp: '123456' }

describe('initiate-withdrawal untraceable credits', () => {
  beforeEach(() => { enqueue.mockClear(); processBatch.mockClear(); checkBalance.mockClear(); createTransferRecipient.mockClear(); initiateTransfer.mockClear() })

  it('refuses with the held and withdrawable amounts, emails once, and never calls Paystack', async () => {
    const res = await call(base)
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatchObject({ error: 'untraceable_credits', withdrawableCoins: 10, heldCoins: 5 })
    expect(res.body.message).toContain('5 CareCoins')
    expect(res.body.message).toContain('10 CareCoins')

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'wallet_needs_attention',
      toEmail: 'u@example.com',
      idempotencyKey: 'wallet-needs-attention:user-12345678',
      payload: { fullName: 'Ada Obi', heldCoins: '5', withdrawableCoins: '10' },
    }))
    expect(processBatch).toHaveBeenCalledTimes(1)

    expect(checkBalance).not.toHaveBeenCalled()
    expect(createTransferRecipient).not.toHaveBeenCalled()
    expect(initiateTransfer).not.toHaveBeenCalled()
    expect(h.rpcCalls.map(([n]) => n)).toContain('create_withdrawal')
    expect(h.rpcCalls.map(([n]) => n)).not.toContain('attach_withdrawal_transfer')
  })

  it('keeps the exact reservation response for other outcomes (no stray email)', async () => {
    h.created = { outcome: 'insufficient' }
    const res = await call(base)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('insufficient')
    expect(enqueue).not.toHaveBeenCalled()
    h.created = { outcome: 'untraceable_credits', withdrawable_coins: 10, untraceable_coins: 5 }
  })
})
