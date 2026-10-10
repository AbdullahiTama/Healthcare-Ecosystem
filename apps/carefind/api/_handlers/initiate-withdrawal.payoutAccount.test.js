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
      in: (col, vals) => { rows = rows.filter((r) => vals.includes(r[col])); return b },
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
const mailer = vi.hoisted(() => ({ sendPinLocked: vi.fn(async () => ({ ok: true })) }))
vi.mock('../_lib/securityMailer.js', () => ({ getSecurityMailer: async () => mailer }))
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
import { enqueue } from '../_lib/emailService.js'

const REF = 'cf_wd_0123456789abcdef0123456789abcdef'
const SAVED = { id: 'pa-1', owner_type: 'user', owner_id: 'user-12345678', status: 'verified', bank_code: '058', bank_name: 'Guaranty Trust Bank', account_number: '0123456789', account_name: 'ADA CHINYERE OBI', verified_at: '2020-01-01T00:00:00Z' }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; r.setHeader = () => {}; return r }
const created = (name) => h.rpcCalls.filter(([n]) => n === name)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.tables = { payout_accounts: [SAVED], financial_config: [{ key: 'payout_account_required', value: 0 }, { key: 'coin_value_kobo', value: 20000 }], kyc_verifications: [{ user_id: 'user-12345678', tier: 2 }] }
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
    h.tables.financial_config = [{ key: 'payout_account_required', value: 1 }, { key: 'coin_value_kobo', value: 20000 }]
    const r = res()
    await handler({ method: 'POST', body: typed }, r)
    expect(r.statusCode).toBe(400)
    expect(r.body.code).toBe('payout_account_required')
    expect(created('create_withdrawal')).toHaveLength(0)
  })

  it('on: a saved account still works', async () => {
    h.tables.financial_config = [{ key: 'payout_account_required', value: 1 }, { key: 'coin_value_kobo', value: 20000 }]
    const r = res()
    await handler({ method: 'POST', body: { amount: 10, pin: '1234', payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(200)
  })
})

describe('Phase 4: tier ceilings and the new-account cooling-off cap (folded into the engine cap)', () => {
  const body = { amount: 10, pin: '1234', payoutAccountId: 'pa-1' }
  const capSent = () => created('create_withdrawal')[0][1].p_daily_cap_coins
  const withLimits = (rows) => { h.tables.financial_config = [{ key: 'payout_account_required', value: 0 }, { key: 'coin_value_kobo', value: 20000 }, ...rows] }

  it('tier 2: a long-standing account is not capped below the trust-level cap (50 coins here)', async () => {
    await handler({ method: 'POST', body }, res())
    expect(capSent()).toBe(50)
  })

  it('tier 1 ceiling (N50,000 = 250 coins) only bites when it is lower than the trust cap', async () => {
    h.tables.kyc_verifications = [{ user_id: 'user-12345678', tier: 1 }]
    await handler({ method: 'POST', body }, res())
    expect(capSent()).toBe(50) // trust cap 50 is tighter than 250
    h.rpcCalls.length = 0
    withLimits([{ key: 'kyc_tier1_daily_cap_kobo', value: 2000000 }]) // N20,000 = 100 coins... still above 50
    await handler({ method: 'POST', body }, res())
    expect(capSent()).toBe(50)
    h.rpcCalls.length = 0
    withLimits([{ key: 'kyc_tier1_daily_cap_kobo', value: 400000 }]) // N4,000 = 20 coins
    await handler({ method: 'POST', body }, res())
    expect(capSent()).toBe(20)
  })

  it('a new account (inside the cooling-off window) caps the 24h total at the cooling-off amount', async () => {
    h.tables.payout_accounts = [{ ...SAVED, verified_at: new Date(Date.now() - 3600_000).toISOString() }] // 1 h old
    withLimits([{ key: 'payout_account_cooloff_daily_cap_kobo', value: 200000 }]) // N2,000 = 10 coins
    await handler({ method: 'POST', body }, res())
    expect(capSent()).toBe(10)
  })

  it('an old account (past the window) gets no cooling-off cap', async () => {
    h.tables.payout_accounts = [{ ...SAVED, verified_at: new Date(Date.now() - 30 * 3600_000).toISOString() }] // 30 h old
    withLimits([{ key: 'payout_account_cooloff_daily_cap_kobo', value: 200000 }])
    await handler({ method: 'POST', body }, res())
    expect(capSent()).toBe(50)
  })

  it('when the engine says daily_limit because of a new account, the person is told why and until when', async () => {
    h.tables.payout_accounts = [{ ...SAVED, verified_at: new Date(Date.now() - 3600_000).toISOString() }]
    withLimits([{ key: 'payout_account_cooloff_daily_cap_kobo', value: 200000 }])
    h.routes.create_withdrawal = { data: { outcome: 'daily_limit' } }
    const r = res()
    await handler({ method: 'POST', body }, r)
    expect(r.statusCode).toBe(429)
    expect(r.body).toMatchObject({ error: 'daily_limit', limitReason: 'new_account', dailyCapCoins: 10 })
    expect(r.body.message).toMatch(/new, so withdrawals are limited/)
    expect(r.body.coolingEndsAt).toBeTruthy()
  })

  it('typed-in (legacy) destinations are not given a tier cap: today\'s trust-level cap applies unchanged', async () => {
    await handler({ method: 'POST', body: { amount: 10, pin: '1234', bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'ADA CHINYERE OBI' } }, res())
    expect(capSent()).toBe(50)
  })
})

describe('Phase 4: alerts', () => {
  it('the withdrawal-requested alert shows only the last four digits of the destination', async () => {
    enqueue.mockClear()
    await handler({ method: 'POST', body: { amount: 10, pin: '1234', payoutAccountId: 'pa-1' } }, res())
    const payload = enqueue.mock.calls[0][0].payload
    expect(payload.accountNumber).toBe('••••6789')
    expect(payload.accountNumber).not.toContain('0123456789')
  })

  it('the wrong PIN that locks it (5th in a row) emails the owner; earlier wrong PINs do not', async () => {
    mailer.sendPinLocked.mockClear()
    h.routes.verify_withdrawal_pin = { data: false }
    h.routes.get_withdrawal_pin = { data: [{ pin_hash: 'x', pin_salt: 's', locked_until: null, failed_attempts: 3 }] }
    await handler({ method: 'POST', body: { amount: 10, pin: '0000', payoutAccountId: 'pa-1' } }, res())
    expect(mailer.sendPinLocked).not.toHaveBeenCalled()
    h.routes.get_withdrawal_pin = { data: [{ pin_hash: 'x', pin_salt: 's', locked_until: null, failed_attempts: 4 }] }
    const r = res()
    await handler({ method: 'POST', body: { amount: 10, pin: '0000', payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(403)
    expect(mailer.sendPinLocked).toHaveBeenCalledWith({ to: 'u@example.com' })
  })
})
