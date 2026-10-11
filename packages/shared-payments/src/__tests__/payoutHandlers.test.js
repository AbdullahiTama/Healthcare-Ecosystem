import { describe, it, expect, vi } from 'vitest'
import { createKycHandler, createPayoutAccountsHandler } from '../payoutHandlers.js'
import { hashPin, randomPinSalt } from '../pin.js'

process.env.OTP_HMAC_SECRET = 'test-secret'

const res = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } })
const user = { id: 'u1', email: 'a@x.com', email_confirmed_at: 't' }
const salt = randomPinSalt()

function db(over = {}) {
  const calls = []
  return {
    calls,
    from: (table) => {
      // financial_config answers from `config` (default: empty = every switch at its default, KYC OFF); the rest as before
      const rows = () => (table === 'financial_config' ? (over.config ?? []) : (over.accounts ?? []))
      const q = { select: () => q, eq: () => q, in: () => q, order: () => q, maybeSingle: async () => ({ data: table === 'financial_config' ? null : (over.account ?? over.kyc ?? null) }), then: (r) => r({ data: rows() }) }
      return q
    },
    rpc: vi.fn(async (n, a) => {
      calls.push([n, a])
      if (n === 'get_withdrawal_pin') return { data: [{ pin_hash: hashPin('1234', salt), pin_salt: salt, locked_until: null }] }
      if (n === 'verify_withdrawal_pin') return { data: over.pinOk !== false }
      return { data: over.rpc?.[n] ?? null, error: null }
    }),
  }
}
const call = (handler, action, body = {}, method = 'POST') => handler({ method, url: `/api/x/${action}`, body, headers: {} }, res()).then(() => null)
const run = async (handler, action, body = {}, method = 'POST') => { const r = res(); await handler({ method, url: `/api/x/${action}`, body, headers: {} }, r); return r }
const mailer = { sendPayoutAccount: vi.fn(async () => ({ ok: true })), sendOtp: vi.fn(async () => ({ ok: true })) }

describe('createKycHandler', () => {
  const make = (d, auth = { user }) => createKycHandler({ supabase: d, authenticate: async () => auth, getProvider: () => ({ lookupBvn: async () => ({ firstName: 'A', lastName: 'B', middleName: '' }), lookupNin: async () => ({ firstName: 'A', lastName: 'B', middleName: '' }) }) })

  it('requires POST and an authenticated caller', async () => {
    expect((await run(make(db()), 'status', {}, 'GET')).statusCode).toBe(405)
    expect((await run(make(db(), { status: 401, error: 'not_logged_in' }), 'status')).statusCode).toBe(401)
  })
  it('status never exposes hashes', async () => {
    const r = await run(make(db({ config: [{ key: 'kyc_enabled', value: 1 }], kyc: { tier: 1, bvn_last4: '1234', nin_last4: '5678', legal_first_name: 'A', legal_last_name: 'B' } })), 'status')
    expect(r.body).toMatchObject({ verified: true, bvnLast4: '1234' })
    expect(JSON.stringify(r.body)).not.toMatch(/hash/i)
  })
  it('verify validates input; unknown actions 404', async () => {
    const on = { config: [{ key: 'kyc_enabled', value: 1 }] }
    expect((await run(make(db(on)), 'verify', { bvn: '1', nin: '2' })).statusCode).toBe(400)
    expect((await run(make(db(on)), 'nope')).statusCode).toBe(404)
  })
})

describe('createPayoutAccountsHandler', () => {
  const owner = { user, ownerType: 'user', ownerId: 'u1' }
  const make = (d, auth = owner) => createPayoutAccountsHandler({
    supabase: d, authenticate: async () => auth, resolveAccount: async () => ({ accountName: 'A B' }),
    banks: { nameFor: async () => 'Bank' }, getMailer: async () => mailer,
  })

  it('list returns masked accounts for the authenticated owner only', async () => {
    const r = await run(make(db({ accounts: [{ id: 'a', bank_code: '1', bank_name: 'B', account_number: '0123456789', account_name: 'N', is_default: true, verified_at: 't' }] })), 'list')
    expect(r.body.accounts[0].accountLast4).toBe('6789')
    expect(JSON.stringify(r.body)).not.toContain('0123456789')
    expect((await run(make(db(), { status: 401, error: 'not_logged_in' }), 'list')).statusCode).toBe(401)
  })

  it('add does not ask for an identity: with a valid code it saves, and the code check is the gate', async () => {
    const saved = await run(make(db({ rpc: { verify_otp: 'ok', payout_account_add: { outcome: 'ok', id: 'pa-9' } } })), 'add', { bankCode: '1', accountNumber: '0123456789', otp: '123456' })
    expect(saved.statusCode).toBe(201)
    const refused = await run(make(db({ rpc: { verify_otp: 'invalid' } })), 'add', { bankCode: '1', accountNumber: '0123456789', otp: '123456' })
    expect(refused.body.code).toBe('otp_invalid')
  })

  it('set-default tells the owner (a security alert) and only for an account the owner has', async () => {
    mailer.sendPayoutAccount.mockClear()
    const d = db({ account: { id: 'a1', bank_name: 'GTBank', bank_code: '058', account_number: '0123456789', account_name: 'N', verified_at: 't' }, rpc: { payout_account_set_default: 'ok' } })
    expect((await run(make(d), 'default', { id: 'a1' })).statusCode).toBe(200)
    expect(mailer.sendPayoutAccount).toHaveBeenCalledWith(expect.objectContaining({ event: 'default', bankName: 'GTBank', accountLast4: '6789' }))
    mailer.sendPayoutAccount.mockClear()
    const missing = db({ accounts: [], rpc: { payout_account_set_default: 'not_found' } })
    expect((await run(make(missing), 'default', { id: 'zzz' })).statusCode).toBe(404)
    expect(mailer.sendPayoutAccount).not.toHaveBeenCalled()
  })

  it('remove needs the withdrawal PIN: none/wrong -> refused and nothing disabled', async () => {
    const d = db({ pinOk: false, rpc: { payout_account_disable: 'ok' } })
    expect((await run(make(d), 'remove', { id: 'a1' })).statusCode).toBe(400)
    expect((await run(make(d), 'remove', { id: 'a1', pin: '9999' })).statusCode).toBe(403)
    expect(d.calls.some(([n]) => n === 'payout_account_disable')).toBe(false)
  })

  it('remove with the right PIN disables it', async () => {
    const d = db({ rpc: { payout_account_disable: 'ok' } })
    expect((await run(make(d), 'remove', { id: 'a1', pin: '1234' })).statusCode).toBe(200)
    expect(d.calls.find(([n]) => n === 'payout_account_disable')[1]).toEqual({ p_owner_type: 'user', p_owner_id: 'u1', p_id: 'a1' })
  })

  it('the owner comes from authentication, never from the request body', async () => {
    const d = db({ rpc: { payout_account_set_default: 'ok' } })
    await run(make(d), 'default', { id: 'a1', ownerId: 'attacker', ownerType: 'business' })
    expect(d.calls.find(([n]) => n === 'payout_account_set_default')[1]).toEqual({ p_owner_type: 'user', p_owner_id: 'u1', p_id: 'a1' })
  })

  it('otp sends a payout_account code', async () => {
    const d = db({ rpc: { issue_otp: 'ok' } })
    const r = await run(make(d), 'otp')
    expect(r.statusCode).toBe(200)
    expect(d.calls[0][1].p_purpose).toBe('payout_account')
  })

  it('unknown action 404', async () => {
    expect((await run(make(db()), 'zzz')).statusCode).toBe(404)
  })
})

// H06: identity verification is OFF unless financial_config.kyc_enabled = 1.
describe('createKycHandler with identity verification switched OFF (the default)', () => {
  const build = (d) => {
    const getProvider = vi.fn(() => ({ lookupBvn: vi.fn(), lookupNin: vi.fn(), verifySelfie: vi.fn() }))
    return { handler: createKycHandler({ supabase: d, authenticate: async () => ({ user }), getProvider }), getProvider }
  }

  it.each([
    ['no row at all (the missing-row default)', {}],
    ['an explicit 0', { config: [{ key: 'kyc_enabled', value: 0 }] }],
    ['junk', { config: [{ key: 'kyc_enabled', value: 'yes' }] }],
    ['2 (only exactly 1 turns it on)', { config: [{ key: 'kyc_enabled', value: 2 }] }],
  ])('%s: verify and selfie are 404 kyc_disabled and the provider is never even constructed', async (_label, over) => {
    const { handler, getProvider } = build(db({ ...over, kyc: { tier: 2, bvn_last4: '1234' } }))
    for (const action of ['verify', 'selfie']) {
      const r = await run(handler, action, { bvn: '22222222222', nin: '11111111111', selfieImage: 'x' })
      expect(r.statusCode).toBe(404)
      expect(r.body.code).toBe('kyc_disabled')
    }
    expect(getProvider).not.toHaveBeenCalled()
  })

  it('status answers "not enabled" for an older client, and exposes nothing from a KYC row', async () => {
    const { handler } = build(db({ kyc: { tier: 2, bvn_last4: '1234', nin_last4: '5678', legal_first_name: 'Ada', legal_last_name: 'Obi' } }))
    const r = await run(handler, 'status')
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ enabled: false, verified: false, tier: 0, bvnLast4: null, ninLast4: null, legalName: null, selfieVerified: false })
  })

  it('still needs a signed-in caller and POST, and unknown actions are 404', async () => {
    const { handler } = build(db())
    expect((await run(handler, 'status', {}, 'GET')).statusCode).toBe(405)
    const anon = createKycHandler({ supabase: db(), authenticate: async () => ({ status: 401, error: 'not_logged_in' }), getProvider: vi.fn() })
    expect((await run(anon, 'verify')).statusCode).toBe(401)
    expect((await run(handler, 'nope')).statusCode).toBe(404)
  })

  it('switching it on restores the endpoints (the provider is built only then)', async () => {
    const { handler, getProvider } = build(db({ config: [{ key: 'kyc_enabled', value: 1 }] }))
    const r = await run(handler, 'verify', { bvn: '1', nin: '2' })
    expect(r.statusCode).toBe(400) // input validation: the real handler ran
    expect(r.body.code).toBe('invalid_id')
    expect(getProvider).toHaveBeenCalled() // only now is the provider built
  })
})
