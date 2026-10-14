// CareHub withdrawal-pin OTP draft lifecycle (Phase 1 final review): the code is
// issued for a server-owned amount + destination; reissue voids first; a failed
// send leaves no phantom draft; a missing destination or secret fails closed.
const h = vi.hoisted(() => {
  const s = { rpcCalls: [], auth: null, issued: 'ok', createFirst: null, draftRow: null }
  const draftChain = () => {
    const b = {}
    b.maybeSingle = async () => ({ data: s.draftRow, error: null })
    for (const m of ['select', 'eq', 'is', 'gt', 'order', 'limit']) b[m] = () => b
    return b
  }
  s.client = {
    from: (table) => {
      if (table === 'withdrawal_drafts') return draftChain()
      const b = {}
      b.maybeSingle = async () => ({ data: null })
      for (const m of ['select', 'eq', 'or', 'in', 'is', 'gt', 'order', 'limit']) b[m] = () => b
      return b
    },
    rpc: async (name, args) => {
      s.rpcCalls.push([name, args])
      if (name === 'issue_otp') return { data: s.issued }
      if (name === 'create_withdrawal_draft') {
        if (s.createFirst) { const d = s.createFirst; s.createFirst = null; return { data: d, error: null } }
        return { data: { ok: true, draft_id: 'd-2' }, error: null }
      }
      if (name === 'void_withdrawal_draft') return { data: null, error: null }
      return { data: null, error: null }
    },
  }
  s.mailer = { sendOtp: async () => ({ ok: true }) }
  return s
})

vi.mock('../_lib/supabase.js', () => ({ supabase: h.client }))
vi.mock('../_lib/verifyBusiness.js', () => ({ verifyBusiness: async () => h.auth }))
vi.mock('../_lib/securityMailer.js', () => ({ getSecurityMailer: async () => h.mailer }))

import handler from './withdrawal-pin.js'

process.env.OTP_HMAC_SECRET = 'test-secret'
const rpcs = (n) => h.rpcCalls.filter(([name]) => name === n)

function call(action, body = {}, method = 'POST') {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  return handler({ method, url: `/api/withdrawal-pin/${action}`, body, headers: {} }, res).then(() => res)
}

beforeEach(() => {
  h.rpcCalls.length = 0
  h.issued = 'ok'; h.createFirst = null; h.draftRow = null
  h.auth = { business: { id: 'biz-1' }, user: { id: 'user-1', email: 'u@x.com', email_confirmed_at: '2026-01-01T00:00:00Z' } }
  h.mailer.sendOtp = vi.fn(async () => ({ ok: true }))
})

describe('/api/withdrawal-pin otp draft lifecycle (CareHub)', () => {
  it('a withdrawal code needs a destination: amount alone is refused', async () => {
    const r = await call('otp', { purpose: 'withdrawal', amount: 500000 })
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_destination' })
    expect(rpcs('create_withdrawal_draft')).toHaveLength(0)
    expect(rpcs('issue_otp')).toHaveLength(0)
  })

  it('a 10-digit account number is required for a typed destination (mirrors the submit)', async () => {
    const r = await call('otp', { purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '123' })
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatchObject({ code: 'draft_destination' })
  })

  it('a withdrawal code with amount + destination drafts then issues', async () => {
    const r = await call('otp', { purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    expect(r.statusCode).toBe(200)
    expect(rpcs('create_withdrawal_draft')).toHaveLength(1)
    expect(rpcs('issue_otp')).toHaveLength(1)
  })

  it('a live draft without reissue stays 409 and is never voided', async () => {
    h.createFirst = { ok: false, outcome: 'draft_active' }
    const r = await call('otp', { purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    expect(r.statusCode).toBe(409)
    expect(r.body).toMatchObject({ code: 'draft_active' })
    expect(rpcs('void_withdrawal_draft')).toHaveLength(0)
    expect(rpcs('issue_otp')).toHaveLength(0)
  })

  it('reissue voids the live draft, then drafts + issues the new code', async () => {
    h.createFirst = { ok: false, outcome: 'draft_active' }
    const r = await call('otp', { purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '0123456789', reissue: true })
    expect(r.statusCode).toBe(200)
    expect(rpcs('void_withdrawal_draft')).toHaveLength(1)
    expect(rpcs('void_withdrawal_draft')[0][1]).toMatchObject({ p_user_id: 'user-1', p_reason: 'reissue' })
    expect(rpcs('create_withdrawal_draft')).toHaveLength(2)
    expect(rpcs('issue_otp')).toHaveLength(1)
  })

  it('reissue inside the cooldown voids nothing and returns the cooldown untouched', async () => {
    h.createFirst = { ok: false, outcome: 'draft_active' }
    h.issued = 'cooldown'
    const r = await call('otp', { purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '0123456789', reissue: true })
    expect(r.statusCode).toBe(429)
    expect(rpcs('void_withdrawal_draft')).toHaveLength(0)
    expect(rpcs('create_withdrawal_draft')).toHaveLength(1)
  })

  it('a failed send voids the draft it just created (no phantom lock)', async () => {
    h.mailer.sendOtp = vi.fn(async () => ({ ok: false, error: 'smtp down' }))
    const r = await call('otp', { purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '0123456789' })
    expect(r.statusCode).toBe(502)
    expect(rpcs('void_withdrawal_draft')).toHaveLength(1)
    expect(rpcs('void_withdrawal_draft')[0][1]).toMatchObject({ p_user_id: 'user-1', p_reason: 'issue_failed' })
  })

  it('the draft action never exposes the destination fingerprint', async () => {
    h.draftRow = { id: 'd-1', app: 'carehub', amount: 500000, unit: 'kobo', destination_fp: 'saved:acc-1', destination_mask: '••••cc-1' }
    const r = await call('draft')
    expect(r.statusCode).toBe(200)
    expect(r.body.draft).toMatchObject({ id: 'd-1', amount: 500000 })
    expect('destination_fp' in (r.body.draft || {})).toBe(false)
  })

  it('a misconfigured draft secret fails closed without issuing', async () => {
    const savedSecret = process.env.OTP_HMAC_SECRET
    const savedRole = process.env.SUPABASE_SERVICE_ROLE_KEY
    try {
      delete process.env.OTP_HMAC_SECRET
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
      const r = await call('otp', { purpose: 'withdrawal', amount: 500000, bankCode: '058', accountNumber: '0123456789' })
      expect(r.statusCode).toBe(503)
      expect(r.body).toMatchObject({ code: 'draft_unavailable' })
      expect(rpcs('issue_otp')).toHaveLength(0)
    } finally {
      if (savedSecret !== undefined) process.env.OTP_HMAC_SECRET = savedSecret
      if (savedRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedRole
    }
  })
})
