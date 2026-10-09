// A saved, identity-verified payout account decides where a withdrawal goes: the details are read from the database
// and anything the browser sends for the destination is ignored. With financial_config.payout_account_required = 1
// a typed-in destination is refused outright.
const h = vi.hoisted(() => {
  const s = { rpcCalls: [], tables: {}, routes: {}, resolved: { accountName: 'ADA CHINYERE OBI' } }
  const builderFor = (table) => {
    let rows = s.tables[table] || []
    const b = {
      select: () => b, order: () => b, limit: () => b, is: () => b, update: () => b,
      eq: (col, val) => { rows = rows.filter((r) => r[col] === val); return b },
      maybeSingle: async () => ({ data: rows[0] ?? null }),
      then: (resolve) => resolve({ error: null, data: rows }),
    }
    return b
  }
  s.client = {
    from: (t) => builderFor(t),
    rpc: async (name, args) => { s.rpcCalls.push([name, args]); const r = s.routes[name]; return typeof r === 'function' ? r(args) : r || { data: null } },
  }
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => ({ id: 'user-12345678', email: 'u@example.com' }) }))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/pinCrypto.js', () => ({ hashPin: () => 'h', verifyPin: () => true, isValidPin: () => true }))
vi.mock('../_lib/trustLevels.js', () => ({ getRequiredAuth: () => ['pin'], isInstantEligible: () => false, getDailyCap: () => 50 }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: vi.fn(async () => 'RCP_1'),
  initiateTransfer: vi.fn(async () => ({ transferCode: 'TRF_1' })),
  checkBalance: vi.fn(async () => 10_000_000_00),
  normalizeAccountName: (n) => String(n).trim().toLowerCase(),
  resolveAccount: async () => h.resolved,
}))

import handler from './initiate-withdrawal.js'

const REF = 'cf_wd_0123456789abcdef0123456789abcdef'
const SAVED = { id: 'pa-1', owner_type: 'user', owner_id: 'user-12345678', status: 'verified', bank_code: '058', bank_name: 'Guaranty Trust Bank', account_number: '0123456789', account_name: 'ADA CHINYERE OBI' }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; r.setHeader = () => {}; return r }
const created = (name) => h.rpcCalls.filter(([n]) => n === name)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.tables = { payout_accounts: [SAVED], financial_config: [{ key: 'payout_account_required', value: 0 }] }
  h.resolved = { accountName: 'ADA CHINYERE OBI' }
  h.routes.get_withdrawal_trust = { data: { trust_level: 'new' } }
  h.routes.get_withdrawal_pin = { data: [{ pin_hash: 'x', pin_salt: 's', locked_until: null }] }
  h.routes.verify_withdrawal_pin = { data: true }
  h.routes.create_withdrawal = { data: { outcome: 'ok', id: 'wd-1', reference: REF, coins: 10, payout_kobo: 160000 } }
  h.routes.attach_withdrawal_transfer = { data: 'ok' }
})

describe('initiate-withdrawal with a saved payout account', () => {
  it('uses the saved account\'s details and ignores whatever destination the browser sent', async () => {
    const r = res()
    await handler({ method: 'POST', body: { amount: 10, pin: '1234', payoutAccountId: 'pa-1', bankCode: '999', bankName: 'Evil Bank', accountNumber: '9999999999', accountName: 'Mallory' } }, r)
    expect(r.statusCode).toBe(200)
    expect(created('create_withdrawal')[0][1]).toMatchObject({
      p_bank_code: '058', p_bank_name: 'Guaranty Trust Bank', p_account_number: '0123456789', p_account_name: 'ADA CHINYERE OBI',
    })
  })

  it('works with only an amount, a PIN and the account id', async () => {
    const r = res()
    await handler({ method: 'POST', body: { amount: 10, pin: '1234', payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(200)
  })

  it('refuses an account that is not the caller\'s, disabled, or unknown - before any money is reserved', async () => {
    for (const rows of [[{ ...SAVED, owner_id: 'someone-else' }], [{ ...SAVED, status: 'disabled' }], []]) {
      h.tables.payout_accounts = rows
      h.rpcCalls.length = 0
      const r = res()
      await handler({ method: 'POST', body: { amount: 10, pin: '1234', payoutAccountId: 'pa-1' } }, r)
      expect(r.statusCode).toBe(400)
      expect(r.body.code).toBe('payout_account_not_found')
      expect(created('create_withdrawal')).toHaveLength(0)
    }
  })

  it('still re-checks the account with the bank: a changed name stops the withdrawal before reserving', async () => {
    h.resolved = { accountName: 'SOMEONE ELSE ENTIRELY' }
    const r = res()
    await handler({ method: 'POST', body: { amount: 10, pin: '1234', payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(400)
    expect(created('create_withdrawal')).toHaveLength(0)
  })

  it('still needs the PIN', async () => {
    h.routes.verify_withdrawal_pin = { data: false }
    const r = res()
    await handler({ method: 'POST', body: { amount: 10, pin: '0000', payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(403)
    expect(created('create_withdrawal')).toHaveLength(0)
  })
})

describe('payout_account_required', () => {
  const typed = { amount: 10, pin: '1234', bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'ADA CHINYERE OBI' }

  it('off: a typed destination still works (today\'s behaviour)', async () => {
    const r = res()
    await handler({ method: 'POST', body: typed }, r)
    expect(r.statusCode).toBe(200)
  })

  it('on: a typed destination is refused before anything is reserved', async () => {
    h.tables.financial_config = [{ key: 'payout_account_required', value: 1 }]
    const r = res()
    await handler({ method: 'POST', body: typed }, r)
    expect(r.statusCode).toBe(400)
    expect(r.body.code).toBe('payout_account_required')
    expect(created('create_withdrawal')).toHaveLength(0)
  })

  it('on: a saved account still works', async () => {
    h.tables.financial_config = [{ key: 'payout_account_required', value: 1 }]
    const r = res()
    await handler({ method: 'POST', body: { amount: 10, pin: '1234', payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(200)
  })
})
