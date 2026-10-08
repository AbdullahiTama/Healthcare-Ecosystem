// Phase 16 A7: saved payout accounts handler. Ownership scoping on every action, the
// audit-first remove/edit writes (event insert precedes the row change, old details snapshotted
// into meta), the "default implies verified + PIN + fresh OTP" gate, and the edit action's
// reset to pending_review with the default cleared (plan bullet: edit must not let a
// pending_review account stay default).
const h = vi.hoisted(() => {
  const state = {
    user: { id: 'user-1' },
    row: null,
    list: [],
    inserted: null,
    updated: null,
    pinRow: null,
    calls: [],
    otp: {},
    otpFn: null,
    resolveImpl: null,
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

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.db }))
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: async () => h.user }))
vi.mock('../_lib/paystackTransfer.js', () => ({
  resolveAccount: (...args) => h.resolveImpl(...args),
  normalizeAccountName: (n) => String(n ?? '').toUpperCase().replace(/\s+/g, ' ').trim(),
}))
vi.mock('../_lib/pinCrypto.js', () => ({
  isValidPin: (p) => /^\d{4}$/.test(String(p)),
  hashPin: (p) => `H:${p}`,
}))
vi.mock('../_lib/emailOtp.js', () => {
  h.otpFn = vi.fn(async () => h.otp)
  return { verifyWithdrawalOtp: h.otpFn }
})

import handler from './payout-accounts.js'

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
const opsOf = (rec) => rec.ops.map((o) => o[0])
const findOp = (rec, op) => rec.ops.find((o) => o[0] === op)

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.row = null
  h.list = []
  h.inserted = null
  h.updated = null
  h.pinRow = null
  h.calls = []
  h.otp = {}
  h.otpFn.mockClear()
  h.resolveImpl = async () => ({ accountName: 'ADA OBI' })
})

describe('GET /api/payout-accounts', () => {
  it('scopes the list to the signed-in user', async () => {
    h.list = [{ id: 'acct-1', status: 'verified' }]
    const res = await call('GET', '/api/payout-accounts')
    expect(res.statusCode).toBe(200)
    expect(res.body.accounts).toEqual(h.list)
    const rec = h.calls[0]
    expect(rec.table).toBe('payout_accounts')
    expect(rec.ops).toContainEqual(['eq', 'owner_user_id', 'user-1'])
    expect(findOp(rec, 'order')).toBeTruthy()
  })
})

describe('auth and method gates', () => {
  it('rejects signed-out callers before any work, and non-GET/POST methods', async () => {
    h.user = null
    expect((await post('/api/payout-accounts', {})).statusCode).toBe(401)
    h.user = { id: 'user-1' }
    expect((await call('DELETE', '/api/payout-accounts')).statusCode).toBe(405)
    expect(h.calls.length).toBe(0)
  })
})

describe('POST /api/payout-accounts (add)', () => {
  const valid = { bankCode: '000', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi', bvn: '12345678901' }

  it('validates required fields, the 10-digit number, and the bank-side name match', async () => {
    expect((await post('/api/payout-accounts', { ...valid, accountName: undefined })).statusCode).toBe(400)
    expect((await post('/api/payout-accounts', { ...valid, accountNumber: '123' })).statusCode).toBe(400)

    h.resolveImpl = async () => { throw new Error('bank down') }
    const down = await post('/api/payout-accounts', valid)
    expect(down.statusCode).toBe(400)
    expect(down.body.error).toContain('Could not verify')

    h.resolveImpl = async () => ({ accountName: 'SOMEONE ELSE' })
    const mismatch = await post('/api/payout-accounts', valid)
    expect(mismatch.statusCode).toBe(400)
    expect(mismatch.body.error).toContain('does not match')
    expect(h.calls.length).toBe(0)
  })

  it('inserts pending_review with last-4 only and records the added event', async () => {
    h.inserted = { id: 'acct-9', status: 'pending_review' }
    const res = await post('/api/payout-accounts', valid)
    expect(res.statusCode).toBe(200)
    expect(res.body.account).toEqual(h.inserted)

    const rowRec = h.calls.find((r) => r.table === 'payout_accounts')
    const payload = findOp(rowRec, 'insert')[1]
    expect(payload).toMatchObject({
      owner_user_id: 'user-1',
      account_number: '0123456789',
      account_name: 'ADA OBI',
      status: 'pending_review',
      bvn_last4: '8901',
      nin_last4: null,
    })
    expect(JSON.stringify(payload)).not.toContain('12345678901')

    const eventRec = h.calls.find((r) => r.table === 'payout_account_events')
    expect(findOp(eventRec, 'insert')[1]).toMatchObject({ payout_account_id: 'acct-9', actor: 'user-1', action: 'added' })
  })
})

describe('POST /api/payout-accounts/set-default', () => {
  const base = { id: 'acct-1', pin: '1234', otp: '654321' }

  it('404s an account the caller does not own and stops before any step-up', async () => {
    h.row = { id: 'acct-1', status: 'verified', owner_user_id: 'someone-else' }
    const res = await post('/api/payout-accounts/set-default', base)
    expect(res.statusCode).toBe(404)
    expect(h.otpFn).not.toHaveBeenCalled()
    expect(h.calls.every((r) => !r.ops.some((o) => o[0] === 'update'))).toBe(true)
  })

  it('requires a verified account before any step-up', async () => {
    h.row = { id: 'acct-1', status: 'pending_review', owner_user_id: 'user-1' }
    const res = await post('/api/payout-accounts/set-default', base)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('verified')
    expect(h.otpFn).not.toHaveBeenCalled()
  })

  it('requires an armed PIN and the correct code', async () => {
    h.row = { id: 'acct-1', status: 'verified', owner_user_id: 'user-1' }
    const noPin = await post('/api/payout-accounts/set-default', base)
    expect(noPin.statusCode).toBe(400)
    expect(noPin.body.error).toContain('Set a withdrawal PIN first')

    h.pinRow = { pin_hash: 'H:1234', pin_salt: 'salt' }
    const wrongPin = await post('/api/payout-accounts/set-default', { ...base, pin: '9999' })
    expect(wrongPin.statusCode).toBe(403)
    expect(wrongPin.body.error).toContain('Incorrect')
    expect(h.otpFn).not.toHaveBeenCalled()
  })

  it('surfaces the OTP failure and makes no writes', async () => {
    h.row = { id: 'acct-1', status: 'verified', owner_user_id: 'user-1' }
    h.pinRow = { pin_hash: 'H:1234', pin_salt: 'salt' }
    h.otp = { error: 'Incorrect or expired code', status: 400 }
    const res = await post('/api/payout-accounts/set-default', base)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('expired')
    expect(h.calls.some((r) => r.ops.some((o) => o[0] === 'update'))).toBe(false)
  })

  it('clears the old default, sets the new one, and records set_default', async () => {
    h.row = { id: 'acct-1', status: 'verified', owner_user_id: 'user-1' }
    h.pinRow = { pin_hash: 'H:1234', pin_salt: 'salt' }
    const res = await post('/api/payout-accounts/set-default', base)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const updates = h.calls.filter((r) => r.ops.some((o) => o[0] === 'update'))
    expect(updates.length).toBe(2)
    expect(findOp(updates[0], 'update')[1]).toEqual({ is_default: false })
    expect(updates[0].ops).toContainEqual(['eq', 'owner_user_id', 'user-1'])
    expect(updates[0].ops).toContainEqual(['eq', 'is_default', true])
    expect(findOp(updates[1], 'update')[1]).toEqual({ is_default: true })
    expect(updates[1].ops).toContainEqual(['eq', 'id', 'acct-1'])

    const eventRec = h.calls.find((r) => r.table === 'payout_account_events')
    expect(findOp(eventRec, 'insert')[1]).toMatchObject({ payout_account_id: 'acct-1', action: 'set_default' })
  })
})

describe('POST /api/payout-accounts/edit', () => {
  const valid = { id: 'acct-1', bankCode: '001', bankName: 'Access Bank', accountNumber: '9876543210', accountName: 'Ada Obi', bvn: '12345678901' }

  it('404s an account the caller does not own, before resolving with the bank', async () => {
    h.row = { id: 'acct-1', owner_user_id: 'someone-else', account_number: '0123456789', bank_code: '000' }
    h.resolveImpl = async () => { throw new Error('must not run') }
    const res = await post('/api/payout-accounts/edit', valid)
    expect(res.statusCode).toBe(404)
    expect(h.calls.length).toBe(1)
  })

  it('re-validates the details exactly like add', async () => {
    h.row = { id: 'acct-1', owner_user_id: 'user-1', account_number: '0123456789', bank_code: '000' }
    expect((await post('/api/payout-accounts/edit', { ...valid, accountNumber: '123' })).statusCode).toBe(400)
    h.resolveImpl = async () => ({ accountName: 'SOMEONE ELSE' })
    const mismatch = await post('/api/payout-accounts/edit', valid)
    expect(mismatch.statusCode).toBe(400)
    expect(mismatch.body.error).toContain('does not match')
    expect(h.calls.some((r) => r.ops.some((o) => o[0] === 'update'))).toBe(false)
  })

  it('snapshots the old details into the edited event BEFORE the row changes, then resets to pending_review', async () => {
    h.row = { id: 'acct-1', owner_user_id: 'user-1', account_number: '0123456789', bank_code: '000' }
    h.updated = { id: 'acct-1', status: 'pending_review', is_default: false }
    const res = await post('/api/payout-accounts/edit', valid)
    expect(res.statusCode).toBe(200)
    expect(res.body.account).toEqual(h.updated)

    const eventIdx = h.calls.findIndex((r) => r.table === 'payout_account_events')
    const updateIdx = h.calls.findIndex((r) => r.ops.some((o) => o[0] === 'update'))
    expect(eventIdx).toBeGreaterThan(-1)
    expect(eventIdx).toBeLessThan(updateIdx)
    expect(findOp(h.calls[eventIdx], 'insert')[1]).toMatchObject({
      payout_account_id: 'acct-1',
      actor: 'user-1',
      action: 'edited',
      meta: { account_number: '0123456789', bank_code: '000', owner_user_id: 'user-1' },
    })

    const payload = findOp(h.calls[updateIdx], 'update')[1]
    expect(payload).toMatchObject({
      bank_code: '001',
      account_number: '9876543210',
      account_name: 'ADA OBI',
      status: 'pending_review',
      verified_at: null,
      is_default: false,
      bvn_last4: '8901',
      nin_last4: null,
    })
    expect(h.calls[updateIdx].ops).toContainEqual(['eq', 'id', 'acct-1'])
  })
})

describe('POST /api/payout-accounts/remove', () => {
  const body = { id: 'acct-1' }

  it('404s an account the caller does not own', async () => {
    h.row = { id: 'acct-1', is_default: false, owner_user_id: 'someone-else', account_number: '0123456789', bank_code: '000' }
    const res = await post('/api/payout-accounts/remove', body)
    expect(res.statusCode).toBe(404)
    expect(h.calls.length).toBe(1)
  })

  it('refuses to remove the default account', async () => {
    h.row = { id: 'acct-1', is_default: true, owner_user_id: 'user-1', account_number: '0123456789', bank_code: '000' }
    const res = await post('/api/payout-accounts/remove', body)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('default')
    expect(h.calls.length).toBe(1)
  })

  it('writes the removed event with a snapshot BEFORE deleting the row', async () => {
    h.row = { id: 'acct-1', is_default: false, owner_user_id: 'user-1', account_number: '0123456789', bank_code: '000' }
    const res = await post('/api/payout-accounts/remove', body)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })

    expect(h.calls[0].table).toBe('payout_accounts')
    expect(opsOf(h.calls[0])).toContain('single')
    expect(h.calls[1].table).toBe('payout_account_events')
    expect(findOp(h.calls[1], 'insert')[1]).toMatchObject({
      payout_account_id: 'acct-1',
      action: 'removed',
      meta: { account_number: '0123456789', bank_code: '000', owner_user_id: 'user-1' },
    })
    expect(h.calls[2].table).toBe('payout_accounts')
    expect(opsOf(h.calls[2])).toContain('delete')
    expect(h.calls[2].ops).toContainEqual(['eq', 'id', 'acct-1'])
  })
})
