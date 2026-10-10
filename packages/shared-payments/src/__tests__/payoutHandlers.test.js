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
    from: () => { const q = { select: () => q, eq: () => q, in: () => q, order: () => q, maybeSingle: async () => ({ data: over.kyc ?? null }), then: (r) => r({ data: over.accounts ?? [] }) }; return q },
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
    const r = await run(make(db({ kyc: { tier: 1, bvn_last4: '1234', nin_last4: '5678', legal_first_name: 'A', legal_last_name: 'B' } })), 'status')
    expect(r.body).toMatchObject({ verified: true, bvnLast4: '1234' })
    expect(JSON.stringify(r.body)).not.toMatch(/hash/i)
  })
  it('verify validates input; unknown actions 404', async () => {
    expect((await run(make(db()), 'verify', { bvn: '1', nin: '2' })).statusCode).toBe(400)
    expect((await run(make(db()), 'nope')).statusCode).toBe(404)
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

  it('add without a verified identity is refused', async () => {
    const r = await run(make(db()), 'add', { bankCode: '1', accountNumber: '0123456789', otp: '123456' })
    expect(r.body.code).toBe('kyc_required')
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
