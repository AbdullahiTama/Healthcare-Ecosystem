// CareHub: a saved, identity-verified payout account (owned by the PARENT business) decides where a business
// withdrawal goes; the browser's bank details are ignored. financial_config.payout_account_required = 1 refuses a
// typed-in destination.
const h = vi.hoisted(() => {
  const s = { initiateTransfer: vi.fn(), createTransferRecipient: vi.fn(), checkBalance: vi.fn(), resolveAccount: vi.fn(), rpcCalls: [], tables: {}, routes: {}, auth: null }
  const builderFor = (table) => {
    let rows = s.tables[table] || []
    const b = {
      select: () => b, or: () => b, is: () => b, order: () => b, limit: () => b,
      in: (col, vals) => { rows = rows.filter((r) => vals.includes(r[col])); return b },
      eq: (col, val) => { rows = rows.filter((r) => r[col] === val); return b },
      maybeSingle: async () => ({ data: rows[0] ?? null }),
      then: (resolve) => resolve({ data: rows, error: null }),
    }
    return b
  }
  s.client = { from: builderFor, rpc: async (n, a) => { s.rpcCalls.push([n, a]); const r = s.routes[n]; return typeof r === 'function' ? r(a) : r || { data: null } } }
  return s
})

const mailer = vi.hoisted(() => ({ sendPinLocked: vi.fn(async () => ({ ok: true })) }))
vi.mock('../_lib/securityMailer.js', () => ({ getSecurityMailer: async () => mailer }))
vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))
vi.mock('../_lib/paystack.js', () => ({ paystackFetch: vi.fn() }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) } }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  createTransferRecipient: h.createTransferRecipient, initiateTransfer: h.initiateTransfer, checkBalance: h.checkBalance, resolveAccount: h.resolveAccount,
}))

import { hashPin } from '@care-ecosystem/shared-payments'
process.env.OTP_HMAC_SECRET = 'test-secret' // the withdrawal code check keys its hash with this
import handler from '../_handlers/initiate-business-withdrawal.js'

const REF = 'ch_wd_0123456789abcdef0123456789abcdef'
const SALT = '00112233445566778899aabbccddeeff'
const SAVED = { id: 'pa-1', owner_type: 'business', owner_id: 'biz-1', status: 'verified', bank_code: '058', bank_name: 'Guaranty Trust Bank', account_number: '0123456789', account_name: 'GRACE PHARMACY LIMITED', verified_at: '2020-01-01T00:00:00Z' }
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const calls = (n) => h.rpcCalls.filter(([name]) => name === n)

beforeEach(() => {
  h.rpcCalls.length = 0
  h.tables = { businesses: [{ id: 'biz-1' }], payout_accounts: [SAVED], financial_config: [{ key: 'payout_account_required', value: 0 }] }
  h.auth = { business: { id: 'biz-1', name: 'Grace Pharmacy' }, user: { id: 'user-1', email: 'b@example.com', email_confirmed_at: '2026-01-01' } }
  h.routes.get_withdrawal_pin = { data: [{ pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null }] }
  h.routes.verify_withdrawal_pin = { data: true }
  h.routes.verify_otp = { data: 'ok' }
  h.routes.create_business_withdrawal = { data: { outcome: 'ok', id: 'bw-1', reference: REF, amount_kobo: 500000 } }
  h.routes.attach_business_withdrawal_transfer = { data: 'ok' }
  h.initiateTransfer.mockReset().mockResolvedValue({ transferCode: 'TRF_1' })
  h.createTransferRecipient.mockReset().mockResolvedValue('RCP_1')
  h.checkBalance.mockReset().mockResolvedValue(10_000_000_00)
  h.resolveAccount.mockReset().mockResolvedValue({ accountName: 'GRACE PHARMACY LIMITED' })
})

const base = { business_id: 'biz-1', amount: 500000, pin: '1234', otp: '123456' }

describe('initiate-business-withdrawal with a saved payout account', () => {
  it('sends the money to the saved account and ignores the browser\'s destination', async () => {
    const r = res()
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1', bankCode: '999', bankName: 'Evil', accountNumber: '9999999999', accountName: 'Mallory' } }, r)
    expect(r.statusCode).toBe(200)
    expect(calls('create_business_withdrawal')[0][1]).toMatchObject({
      p_bank_code: '058', p_bank_name: 'Guaranty Trust Bank', p_account_number: '0123456789', p_account_name: 'GRACE PHARMACY LIMITED',
    })
  })

  it('a branch withdrawal uses the PARENT business\'s account', async () => {
    h.tables.businesses = [{ id: 'branch-1' }]
    const r = res()
    await handler({ method: 'POST', body: { ...base, business_id: 'branch-1', payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(200)
  })

  it('refuses another business\'s, a disabled, or an unknown account before reserving anything', async () => {
    for (const rows of [[{ ...SAVED, owner_id: 'biz-other' }], [{ ...SAVED, status: 'disabled' }], [], [{ ...SAVED, owner_type: 'user' }]]) {
      h.tables.payout_accounts = rows
      h.rpcCalls.length = 0
      const r = res()
      await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1' } }, r)
      expect(r.statusCode).toBe(400)
      expect(r.body.code).toBe('payout_account_not_found')
      expect(calls('create_business_withdrawal')).toHaveLength(0)
    }
  })

  it('still needs the PIN, and the bank re-check still applies', async () => {
    h.routes.verify_withdrawal_pin = { data: false }
    let r = res()
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1', pin: '0000' } }, r)
    expect(r.statusCode).toBe(403)
    h.routes.verify_withdrawal_pin = { data: true }
    h.resolveAccount.mockResolvedValue({ accountName: 'SOMEONE ELSE' })
    r = res()
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(400)
    expect(calls('create_business_withdrawal')).toHaveLength(0)
  })
})

describe('payout_account_required (CareHub)', () => {
  const typed = { ...base, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'GRACE PHARMACY LIMITED' }
  it('off: a typed destination still works', async () => {
    const r = res(); await handler({ method: 'POST', body: typed }, r)
    expect(r.statusCode).toBe(200)
  })
  it('on: a typed destination is refused, a saved account works', async () => {
    h.tables.financial_config = [{ key: 'payout_account_required', value: 1 }]
    let r = res(); await handler({ method: 'POST', body: typed }, r)
    expect(r.statusCode).toBe(400)
    expect(r.body.code).toBe('payout_account_required')
    expect(calls('create_business_withdrawal')).toHaveLength(0)
    r = res(); await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(200)
  })
})

describe('Phase 4 (CareHub): cooling-off cap and alerts', () => {
  const sent = () => calls('create_business_withdrawal')[0][1]

  it('an established account passes NO extra cap: the engine\'s own business ceiling governs', async () => {
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1' } }, res())
    expect(sent()).not.toHaveProperty('p_daily_cap_kobo')
  })

  it('a NEW account caps the business\'s rolling 24h total (N20,000 by default), through the engine\'s own cap parameter', async () => {
    h.tables.payout_accounts = [{ ...SAVED, verified_at: new Date(Date.now() - 3600_000).toISOString() }]
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1' } }, res())
    expect(sent().p_daily_cap_kobo).toBe(2_000_000)
  })

  it('the cooling-off cap can only LOWER the engine ceiling, never raise it', async () => {
    h.tables.payout_accounts = [{ ...SAVED, verified_at: new Date(Date.now() - 3600_000).toISOString() }]
    h.tables.financial_config.push({ key: 'business_withdrawal_daily_cap_kobo', value: 1_000_000 })
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1' } }, res())
    expect(sent().p_daily_cap_kobo).toBe(1_000_000)
  })

  it('tells the owner why a new account was limited', async () => {
    h.tables.payout_accounts = [{ ...SAVED, verified_at: new Date(Date.now() - 3600_000).toISOString() }]
    h.routes.create_business_withdrawal = { data: { outcome: 'daily_limit' } }
    const r = res()
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1' } }, r)
    expect(r.statusCode).toBe(429)
    expect(r.body).toMatchObject({ error: 'daily_limit', limitReason: 'new_account' })
    expect(r.body.message).toMatch(/new, so withdrawals are limited/)
  })

  it('typed-in destinations get no extra cap (unchanged behaviour)', async () => {
    await handler({ method: 'POST', body: { ...base, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'GRACE PHARMACY LIMITED' } }, res())
    expect(sent()).not.toHaveProperty('p_daily_cap_kobo')
  })

  it('the wrong PIN that locks it warns the owner by email', async () => {
    mailer.sendPinLocked.mockClear()
    h.routes.verify_withdrawal_pin = { data: false }
    h.routes.get_withdrawal_pin = { data: [{ pin_hash: hashPin('1234', SALT), pin_salt: SALT, locked_until: null, failed_attempts: 4 }] }
    const r = res()
    await handler({ method: 'POST', body: { ...base, payoutAccountId: 'pa-1', pin: '0000' } }, r)
    expect(r.statusCode).toBe(403)
    expect(mailer.sendPinLocked).toHaveBeenCalledWith({ to: 'b@example.com' })
  })
})

describe('the emailed withdrawal code (third factor)', () => {
  const body = { business_id: 'biz-1', amount: 500000, pin: '1234', payoutAccountId: 'pa-1' }

  it('refuses a withdrawal with no code, before anything is reserved', async () => {
    const r = res()
    await handler({ method: 'POST', body }, r)
    expect(r.statusCode).toBe(400)
    expect(r.body.code).toBe('otp_invalid')
    expect(calls('verify_otp')).toHaveLength(0)
    expect(calls('create_business_withdrawal')).toHaveLength(0)
  })

  it('refuses a wrong, expired or locked code with the engine untouched', async () => {
    for (const [result, status, code] of [['invalid', 400, 'otp_invalid'], ['expired', 400, 'otp_expired'], ['locked', 429, 'otp_locked'], ['none', 400, 'otp_missing']]) {
      h.routes.verify_otp = { data: result }
      h.rpcCalls.length = 0
      const r = res()
      await handler({ method: 'POST', body: { ...body, otp: '123456' } }, r)
      expect(r.statusCode).toBe(status)
      expect(r.body.code).toBe(code)
      expect(calls('create_business_withdrawal')).toHaveLength(0)
    }
  })

  it('checks the code for the withdrawal purpose, and only after the PIN', async () => {
    const r = res()
    await handler({ method: 'POST', body: { ...body, otp: '123456' } }, r)
    expect(r.statusCode).toBe(200)
    const names = h.rpcCalls.map(([n]) => n)
    expect(names.indexOf('verify_withdrawal_pin')).toBeLessThan(names.indexOf('verify_otp'))
    expect(calls('verify_otp')[0][1]).toMatchObject({ p_user_id: 'user-1', p_purpose: 'withdrawal' })
  })

  it('a wrong PIN never touches (or burns) the code', async () => {
    h.routes.verify_withdrawal_pin = { data: false }
    const r = res()
    await handler({ method: 'POST', body: { ...body, otp: '123456' } }, r)
    expect(r.statusCode).toBe(403)
    expect(calls('verify_otp')).toHaveLength(0)
  })
})
