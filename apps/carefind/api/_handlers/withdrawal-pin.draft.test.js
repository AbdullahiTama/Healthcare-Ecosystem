import { describe, it, expect, vi, beforeEach } from 'vitest'

// The 409 matters more than it looks. It is the answer to "a code is already on its way", and it used to carry no issue
// time. The client therefore had no countdown to paint, offered "Send a new code" immediately, and one tap issued a NEW
// code that made the one already sitting in the user's inbox unusable. The next submit could then only answer
// `otp_superseded`, which the user reads as "my correct code was rejected".

vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', user_metadata: {} }) }))

const h = vi.hoisted(() => {
  const s = { rpcCalls: [], draftRow: null, otpResult: { data: 'ok' } }
  const builder = { select: () => builder, eq: () => builder, is: () => builder, gt: () => builder, order: () => builder, limit: () => builder, maybeSingle: async () => ({ data: s.draftRow }) }
  s.client = {
    from: () => builder,
    rpc: async (name, args) => { s.rpcCalls.push([name, args]); const r = s.routes[name]; return typeof r === 'function' ? r(args) : r || { data: null } },
  }
  s.routes = {}
  return s
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('../_lib/securityMailer.js', () => ({ getSecurityMailer: async () => ({ sendOtp: async () => ({ ok: true }) }) }))

process.env.OTP_HMAC_SECRET = 'test-secret'
import handler from './withdrawal-pin.js'

const req = (action, body = {}) => ({ method: 'POST', url: `/api/withdrawal-pin/${action}`, body })
const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; r.setHeader = () => {}; return r }
const calls = (name) => h.rpcCalls.filter(([n]) => n === name)

const ISSUED = new Date(Date.now() - 45_000)
const draftRow = (over = {}) => ({
  id: 'd-1', app: 'carefind', amount: 10, unit: 'coins',
  destination_fp: 'saved:acc-1',
  destination_mask: '••••6789',
  otp_issued_at: ISSUED.toISOString(),
  // The draft still has nine minutes; the code has only four. The countdown must follow the code.
  draft_expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
  ...over,
})

beforeEach(() => {
  h.rpcCalls.length = 0
  h.draftRow = null
  // PostgREST surfaces a jsonb RPC as { data: <jsonb> } and a scalar one as { data: <scalar> }. The handler destructures
  // `data`, so returning the payload bare would silently read as undefined and fall through to the email gate.
  h.routes = { create_withdrawal_draft: { data: { ok: true, outcome: 'ok' } }, issue_otp: { data: 'ok' } }
})

describe('POST /api/withdrawal-pin/draft (resume)', () => {
  it('returns the amount and destination so the form is rebuilt without retyping', async () => {
    h.draftRow = draftRow()
    const r = res()
    await handler(req('draft'), r)
    expect(r.statusCode).toBe(200)
    expect(r.body.draft).toMatchObject({ id: 'd-1', amount: 10, unit: 'coins', destinationKind: 'saved', savedAccountId: 'acc-1' })
  })

  it('never sends the destination fingerprint: it is the submit gate\'s HMAC material', async () => {
    h.draftRow = draftRow({ destination_fp: 'typed:9f8e7d6c5b4a39281706' })
    const r = res()
    await handler(req('draft'), r)
    expect(r.body.draft.destination_fp).toBeUndefined()
    expect(JSON.stringify(r.body)).not.toContain('9f8e7d6c5b4a39281706')
    expect(r.body.draft.destinationKind).toBe('typed')
    expect(r.body.draft.savedAccountId).toBeNull()
  })

  it('reports the CODE expiry, never the longer draft expiry', async () => {
    h.draftRow = draftRow()
    const r = res()
    await handler(req('draft'), r)
    const seconds = (Date.parse(r.body.draft.otpExpiresAt) - Date.parse(ISSUED.toISOString())) / 1000
    expect(seconds).toBe(300)
    expect(Date.parse(r.body.draft.otpExpiresAt)).toBeLessThan(Date.parse(r.body.draft.draft_expires_at))
  })

  it('answers a missing draft with an explicit null, so the client can tell "nothing to resume" apart from a broken payload', async () => {
    h.draftRow = null
    const r = res()
    await handler(req('draft'), r)
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ draft: null })
  })
})

describe('POST /api/withdrawal-pin/otp when a code is already on its way (409 draft_active)', () => {
  // Configured per test, not in a hook: the file-level beforeEach REPLACES h.routes each time, so mutating it from a
  // describe-level hook is an ordering trap.
  const busyServer = (row) => {
    h.routes = { create_withdrawal_draft: { data: { ok: false, outcome: 'draft_active' } } }
    h.draftRow = row
  }

  it('carries the live code\'s issue time so the client can paint a real resend cooldown', async () => {
    busyServer(draftRow())
    const r = res()
    await handler(req('otp', { purpose: 'withdrawal', amount: 10, payoutAccountId: 'acc-1' }), r)
    expect(r.statusCode).toBe(409)
    expect(r.body).toMatchObject({ code: 'draft_active', draftId: 'd-1', amount: 10, unit: 'coins', savedAccountId: 'acc-1' })
    expect(r.body.otpIssuedAt).toBe(ISSUED.getTime())
    expect(r.body.expiresInSeconds).toBeGreaterThan(0)
    expect(r.body.expiresInSeconds).toBeLessThanOrEqual(300)
  })

  it('issues no new code and does not void the draft that is still out', async () => {
    busyServer(draftRow())
    const r = res()
    await handler(req('otp', { purpose: 'withdrawal', amount: 10, payoutAccountId: 'acc-1' }), r)
    expect(r.statusCode).toBe(409)
    expect(calls('issue_otp')).toHaveLength(0)
    expect(calls('void_withdrawal_draft')).toHaveLength(0)
  })

  it('still refuses politely if the draft cannot be read, rather than failing the request', async () => {
    busyServer(null)
    const r = res()
    await handler(req('otp', { purpose: 'withdrawal', amount: 10, payoutAccountId: 'acc-1' }), r)
    expect(r.statusCode).toBe(409)
    expect(r.body).toMatchObject({ code: 'draft_active' })
  })
})

describe('POST /api/withdrawal-pin/otp validation', () => {
  it('refuses a sub-minimum CareFind amount before touching the draft', async () => {
    const r = res()
    await handler(req('otp', { purpose: 'withdrawal', amount: 2, payoutAccountId: 'acc-1' }), r)
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_amount' })
    expect(calls('create_withdrawal_draft')).toHaveLength(0)
  })

  it('refuses a request with no destination', async () => {
    const r = res()
    await handler(req('otp', { purpose: 'withdrawal', amount: 10 }), r)
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_destination' })
  })
})