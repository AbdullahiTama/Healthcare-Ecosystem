// Phase 16 A7: CareHub mirror of the saved-payout-accounts handler. Business scoping on
// every action, the shared PIN/OTP step-up on set-default, and the new edit action's
// audit-first snapshot plus reset to pending_review (default cleared).
const h = vi.hoisted(() => {
  const state = {
    business: { id: 'biz-1' },
    user: { id: 'user-1' },
    authError: null,
    row: null,
    list: [],
    inserted: null,
    updated: null,
    pinRow: null,
    calls: [],
    otp: {},
    otpFn: null,
    pinResult: { ok: true },
    bankResult: { ok: true, accountName: 'ADA OBI' },
  }
  state.result = (rec) => {
    if (rec.table === 'payout_account_events') return { data: null, error: null }
    if (rec.table === 'withdrawal_pins') return { data: state.pinRow, error: null }
    const ops = rec.ops.map((o) => o[0])
    if (ops.includes('insert')) return { data: state.inserted, error: null }
    if (ops.includes('update')) return { data: state.updated, error: null }
    if (ops.includes('delete')) return { data: null, error: null }
    if (ops.includes('single')) return { data: state.row, error: null }
    return { data: state.list, error: null }
  }
  state.db = {
    from(table) {
      const rec = { table, ops: [] }
      state.calls.push(rec)
      const api = {
        select(cols) { rec.ops.push(['select', cols]); return api },
        insert(vals) { rec.ops.push(['insert', vals]); return api },
        update(vals) { rec.ops.push(['update', vals]); return api },
        delete() { rec.ops.push(['delete']); return api },
        eq(col, val) { rec.ops.push(['eq', col, val]); return api },
        order(col, dir) { rec.ops.push(['order', col, dir]); return api },
        single() { rec.ops.push(['single']); return Promise.resolve(state.result(rec)) },
        then(resolve, reject) { return Promise.resolve(state.result(rec)).then(resolve, reject) },
      }
      return api
    },
  }
  return state
})

vi.mock('../_lib/supabase.js', () => ({ supabase: h.db }))
vi.mock('../_lib/verifyBusiness.js', () => ({
  verifyBusiness: async () => (h.authError ? { business: null, user: null, error: h.authError } : { business: h.business, user: h.user, error: null }),
}))
vi.mock('../_lib/paystackTransfer.js', () => ({ resolveAccount: async () => ({ accountName: 'ADA OBI' }) }))
vi.mock('../_lib/emailOtp.js', () => {
  h.otpFn = vi.fn(async () => h.otp)
  return { verifyWithdrawalOtp: h.otpFn }
})
vi.mock('@care-ecosystem/shared-payments', () => ({
  verifyBankAccount: async () => h.bankResult,
  checkWithdrawalPin: async () => h.pinResult,
}))

import handler from '../_handlers/payout-accounts.js'

function call(method, url, body = {}) {
  const res = {
    statusCode: 0,
    body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
  return handler({ method, url, body, headers: {} }, res).then(() => res)
}
const post = (url, body) => call('POST', url, body)
const findOp = (rec, op) => rec.ops.find((o) => o[0] === op)

beforeEach(() => {
  h.business = { id: 'biz-1' }
  h.user = { id: 'user-1' }
  h.authError = null
  h.row = null
  h.list = []
  h.inserted = null
  h.updated = null
  h.pinRow = null
  h.calls = []
  h.otp = {}
  h.otpFn.mockClear()
  h.pinResult = { ok: true }
  h.bankResult = { ok: true, accountName: 'ADA OBI' }
})

describe('auth, method and listing', () => {
  it('rejects a failed business auth before any work', async () => {
    h.authError = 'Not a business account'
    const res = await post('/api/payout-accounts', {})
    expect(res.statusCode).toBe(401)
    expect(h.calls.length).toBe(0)
  })

  it('405s other methods and scopes the list to the business', async () => {
    expect((await call('DELETE', '/api/payout-accounts')).statusCode).toBe(405)
    h.list = [{ id: 'acct-1', status: 'verified' }]
    const res = await call('GET', '/api/payout-accounts')
    expect(res.statusCode).toBe(200)
    expect(res.body.accounts).toEqual(h.list)
    expect(h.calls[0].ops).toContainEqual(['eq', 'owner_business_id', 'biz-1'])
  })
})

describe('POST /api/payout-accounts (add)', () => {
  const valid = { bankCode: '000', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi', nin: '12345678901' }

  it('surfaces the shared bank verification failure', async () => {
    h.bankResult = { ok: false, status: 400, error: 'The account name does not match the account number for this bank.' }
    const res = await post('/api/payout-accounts', valid)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('does not match')
    expect(h.calls.length).toBe(0)
  })

  it('inserts pending_review with NIN last-4 only and records the added event', async () => {
    h.inserted = { id: 'acct-9', status: 'pending_review' }
    const res = await post('/api/payout-accounts', valid)
    expect(res.statusCode).toBe(200)
    expect(res.body.account).toEqual(h.inserted)
    const payload = findOp(h.calls.find((r) => r.table === 'payout_accounts'), 'insert')[1]
    expect(payload).toMatchObject({ owner_business_id: 'biz-1', status: 'pending_review', nin_last4: '8901', bvn_last4: null })
    expect(JSON.stringify(payload)).not.toContain('12345678901')
    expect(findOp(h.calls.find((r) => r.table === 'payout_account_events'), 'insert')[1]).toMatchObject({ action: 'added', actor: 'user-1' })
  })
})

describe('POST /api/payout-accounts/set-default', () => {
  const base = { id: 'acct-1', pin: '1234', otp: '654321' }

  it('enforces ownership, verified status, the shared PIN check and the OTP', async () => {
    h.row = { id: 'acct-1', status: 'verified', owner_business_id: 'someone-else' }
    expect((await post('/api/payout-accounts/set-default', base)).statusCode).toBe(404)
    expect(h.otpFn).not.toHaveBeenCalled()

    h.row = { id: 'acct-1', status: 'pending_review', owner_business_id: 'biz-1' }
    const unverified = await post('/api/payout-accounts/set-default', base)
    expect(unverified.statusCode).toBe(400)
    expect(unverified.body.error).toContain('verified')

    h.row = { id: 'acct-1', status: 'verified', owner_business_id: 'biz-1' }
    h.pinResult = { ok: false, status: 403, error: 'Incorrect withdrawal PIN' }
    const badPin = await post('/api/payout-accounts/set-default', base)
    expect(badPin.statusCode).toBe(403)
    expect(h.otpFn).not.toHaveBeenCalled()

    h.pinResult = { ok: true }
    h.otp = { error: 'Incorrect or expired code', status: 400 }
    const badOtp = await post('/api/payout-accounts/set-default', base)
    expect(badOtp.statusCode).toBe(400)
    expect(h.calls.some((r) => r.ops.some((o) => o[0] === 'update'))).toBe(false)
  })

  it('clears the old default, sets the new one, and records set_default', async () => {
    h.row = { id: 'acct-1', status: 'verified', owner_business_id: 'biz-1' }
    const res = await post('/api/payout-accounts/set-default', base)
    expect(res.statusCode).toBe(200)
    const updates = h.calls.filter((r) => r.ops.some((o) => o[0] === 'update'))
    expect(updates.length).toBe(2)
    expect(findOp(updates[0], 'update')[1]).toEqual({ is_default: false })
    expect(updates[0].ops).toContainEqual(['eq', 'owner_business_id', 'biz-1'])
    expect(findOp(updates[1], 'update')[1]).toEqual({ is_default: true })
    expect(findOp(h.calls.find((r) => r.table === 'payout_account_events'), 'insert')[1]).toMatchObject({ action: 'set_default' })
  })
})

describe('POST /api/payout-accounts/edit', () => {
  const valid = { id: 'acct-1', bankCode: '001', bankName: 'Access Bank', accountNumber: '9876543210', accountName: 'Ada Obi' }

  it('404s an account the business does not own, before bank verification', async () => {
    h.row = { id: 'acct-1', owner_business_id: 'someone-else', account_number: '0123456789', bank_code: '000' }
    h.bankResult = { ok: false, status: 400, error: 'must not surface' }
    const res = await post('/api/payout-accounts/edit', valid)
    expect(res.statusCode).toBe(404)
    expect(h.calls.length).toBe(1)
  })

  it('snapshots the old details into the edited event BEFORE the row changes, then resets to pending_review', async () => {
    h.row = { id: 'acct-1', owner_business_id: 'biz-1', account_number: '0123456789', bank_code: '000' }
    h.updated = { id: 'acct-1', status: 'pending_review', is_default: false }
    const res = await post('/api/payout-accounts/edit', valid)
    expect(res.statusCode).toBe(200)
    expect(res.body.account).toEqual(h.updated)

    const eventIdx = h.calls.findIndex((r) => r.table === 'payout_account_events')
    const updateIdx = h.calls.findIndex((r) => r.ops.some((o) => o[0] === 'update'))
    expect(eventIdx).toBe(1)
    expect(eventIdx).toBeLessThan(updateIdx)
    expect(findOp(h.calls[eventIdx], 'insert')[1]).toMatchObject({
      action: 'edited',
      meta: { account_number: '0123456789', bank_code: '000', owner_business_id: 'biz-1' },
    })
    expect(findOp(h.calls[updateIdx], 'update')[1]).toMatchObject({
      bank_code: '001',
      account_number: '9876543210',
      account_name: 'ADA OBI',
      status: 'pending_review',
      verified_at: null,
      is_default: false,
    })
  })
})

describe('POST /api/payout-accounts/remove', () => {
  it('refuses the default account and otherwise audits before deleting', async () => {
    h.row = { id: 'acct-1', is_default: true, owner_business_id: 'biz-1', account_number: '0123456789', bank_code: '000' }
    const refused = await post('/api/payout-accounts/remove', { id: 'acct-1' })
    expect(refused.statusCode).toBe(400)
    expect(h.calls.length).toBe(1)

    h.calls = []
    h.row = { id: 'acct-1', is_default: false, owner_business_id: 'biz-1', account_number: '0123456789', bank_code: '000' }
    const res = await post('/api/payout-accounts/remove', { id: 'acct-1' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(h.calls[1].table).toBe('payout_account_events')
    expect(findOp(h.calls[1], 'insert')[1]).toMatchObject({
      action: 'removed',
      meta: { account_number: '0123456789', bank_code: '000', owner_business_id: 'biz-1' },
    })
    expect(h.calls[2].ops.map((o) => o[0])).toContain('delete')
  })
})
