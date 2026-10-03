// Financial audit F-02: a truthy `deviceToken` used to replace the withdrawal PIN whenever the
// account had device_trust_enabled, although the token was never compared with anything.
const h = vi.hoisted(() => {
  const s = { rpcCalls: [], trust: { trust_level: 'trusted', device_trust_enabled: true } }
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
      return { data: null }
    },
  }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => ({ id: 'user-12345678', email: 'u@example.com' }) }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/pinCrypto.js', () => ({ hashPin: () => 'h', verifyPin: () => true, isValidPin: () => true }))
vi.mock('../_lib/trustLevels.js', () => ({ getRequiredAuth: () => ['pin'], isInstantEligible: () => false, getDailyCap: () => 50 }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: vi.fn(), initiateTransfer: vi.fn(), checkBalance: vi.fn(),
  normalizeAccountName: (n) => String(n), resolveAccount: vi.fn(), transferReference: () => 'ref',
}))
vi.mock('../_lib/withdrawalRecovery.js', () => ({ reconcileWithdrawal: vi.fn() }))

import handler from './initiate-withdrawal.js'

function call(body) {
  const res = { statusCode: 0, body: null, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method: 'POST', body, headers: {} }, res).then(() => res)
}

const base = { amount: 10, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ada Obi' }

describe('initiate-withdrawal second factor', () => {
  it('rejects a withdrawal that carries only a deviceToken, even when device trust is enabled', async () => {
    const res = await call({ ...base, deviceToken: 'anything' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('Authentication required')
    expect(h.rpcCalls.map(([n]) => n)).not.toContain('request_withdrawal')
  })

  it('still demands a PIN when neither a PIN nor a token is sent', async () => {
    const res = await call(base)
    expect(res.statusCode).toBe(400)
    expect(h.rpcCalls.map(([n]) => n)).not.toContain('request_withdrawal')
  })
})
