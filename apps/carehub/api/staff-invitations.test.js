// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import crypto from 'crypto'
import { createHandler, createInviteToken, INVITE_TTL_DAYS } from './staff-invitations.js'

function fakeSupabase({ user = { email: 'owner@x.com' }, plan = 'basic', rpcResult } = {}) {
  const rpc = vi.fn(async () => rpcResult || {
    data: { staff_id: 's1', email: 'ada@x.com', full_name: 'Ada', role: 'Cashier', business_name: 'Pharma X', expires_at: '2026-10-16T00:00:00Z' },
    error: null,
  })
  return {
    rpc,
    auth: { getUser: vi.fn(async (jwt) => (jwt === 'good' && user ? { data: { user }, error: null } : { data: null, error: { message: 'bad jwt' } })) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'biz-1', plan, parent_business_id: null } }) }) }),
    }),
  }
}

function run(handler, { body, auth = 'Bearer good', method = 'POST' } = {}) {
  const res = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this }, json(p) { this.payload = p; return this } }
  return handler({ method, body, headers: { authorization: auth, host: 'carehub.test' } }, res).then(() => res)
}

const quietLogger = { error: vi.fn() }

describe('createInviteToken', () => {
  it('is 256 bits of randomness, stored only as its sha256 hex', () => {
    const { raw, hash } = createInviteToken()
    expect(Buffer.from(raw, 'base64url')).toHaveLength(32)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // Must match Postgres: encode(extensions.digest(p_token, 'sha256'), 'hex')
    expect(hash).toBe(crypto.createHash('sha256').update(raw, 'utf8').digest('hex'))
    expect(createInviteToken().raw).not.toBe(raw)
  })
})

describe('POST /api/staff-invitations', () => {
  it('rejects anything but POST, and unauthenticated callers', async () => {
    const supabase = fakeSupabase()
    const handler = createHandler({ getSupabase: () => supabase, sendInvitation: vi.fn(), logger: quietLogger })
    expect((await run(handler, { method: 'GET' })).statusCode).toBe(405)
    expect((await run(handler, { auth: '', body: { action: 'invite' } })).statusCode).toBe(401)
    expect((await run(handler, { auth: 'Bearer forged', body: { action: 'invite' } })).statusCode).toBe(401)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('invites as the VERIFIED caller, stores only the hash, and emails the raw token', async () => {
    const supabase = fakeSupabase()
    const sendInvitation = vi.fn(async () => ({ success: true }))
    const now = () => new Date('2026-10-09T00:00:00Z')
    const handler = createHandler({ getSupabase: () => supabase, sendInvitation, now, logger: quietLogger })

    const res = await run(handler, { body: { action: 'invite', business_id: 'biz-1', full_name: 'Ada', email: 'ada@x.com', role: 'Cashier', actor_email: 'spoofed@evil.com' } })

    expect(res.statusCode).toBe(200)
    const [fn, args] = supabase.rpc.mock.calls[0]
    expect(fn).toBe('create_staff_invitation')
    expect(args.p_actor_email).toBe('owner@x.com') // from the JWT, never the body
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(args.p_max_staff).toBe(5) // basic plan
    expect(args.p_expires_at).toBe(new Date(Date.parse('2026-10-09T00:00:00Z') + INVITE_TTL_DAYS * 864e5).toISOString())
    expect(args).not.toHaveProperty('p_password')

    const mail = sendInvitation.mock.calls[0][0]
    const raw = new URL(mail.acceptUrl).searchParams.get('token')
    expect(mail.acceptUrl.startsWith('https://carehub.test/accept-invite?token=')).toBe(true)
    expect(crypto.createHash('sha256').update(raw).digest('hex')).toBe(args.p_token_hash)

    // The token goes to the inbox only — never back to the browser.
    expect(JSON.stringify(res.payload)).not.toContain(raw)
    expect(JSON.stringify(res.payload)).not.toContain(args.p_token_hash)
    expect(res.payload.email_sent).toBe(true)
  })

  it('passes no seat limit for unlimited plans', async () => {
    const supabase = fakeSupabase({ plan: 'growth' })
    const handler = createHandler({ getSupabase: () => supabase, sendInvitation: async () => ({ success: true }), logger: quietLogger })
    await run(handler, { body: { action: 'invite', business_id: 'biz-1', full_name: 'Ada', email: 'ada@x.com', role: 'Cashier' } })
    expect(supabase.rpc.mock.calls[0][1].p_max_staff).toBe(null)
  })

  it("maps the RPC's refusal to 403 / 400 with its message", async () => {
    const denied = fakeSupabase({ rpcResult: { data: null, error: { code: '42501', message: 'You do not have permission to manage staff for this business.' } } })
    const handler = createHandler({ getSupabase: () => denied, sendInvitation: vi.fn(), logger: quietLogger })
    const res = await run(handler, { body: { action: 'invite', business_id: 'biz-1' } })
    expect(res.statusCode).toBe(403)
    expect(res.payload.error).toMatch(/permission/)

    const conflict = fakeSupabase({ rpcResult: { data: null, error: { code: 'P0001', message: "This email is a business owner's CareHub login." } } })
    const res2 = await run(createHandler({ getSupabase: () => conflict, sendInvitation: vi.fn(), logger: quietLogger }), { body: { action: 'invite', business_id: 'biz-1' } })
    expect(res2.statusCode).toBe(400)
    expect(res2.payload.error).toMatch(/owner's CareHub login/)
  })

  it('still reports success when the email fails, so the UI can offer Resend', async () => {
    const supabase = fakeSupabase()
    const logger = { error: vi.fn() }
    let mail
    const handler = createHandler({ getSupabase: () => supabase, sendInvitation: async (m) => { mail = m; throw new Error('resend down') }, logger })
    const res = await run(handler, { body: { action: 'invite', business_id: 'biz-1', full_name: 'Ada', email: 'ada@x.com', role: 'Cashier' } })
    expect(res.statusCode).toBe(200)
    expect(res.payload.email_sent).toBe(false)
    expect(logger.error).toHaveBeenCalled()
    // The failure is logged, but never with the token.
    const raw = new URL(mail.acceptUrl).searchParams.get('token')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(raw)
  })

  it('resend rotates the token through reissue_staff_invitation', async () => {
    const supabase = fakeSupabase()
    const handler = createHandler({ getSupabase: () => supabase, sendInvitation: async () => ({ success: true }), logger: quietLogger })
    const res = await run(handler, { body: { action: 'resend', staff_id: 's1' } })
    expect(res.statusCode).toBe(200)
    expect(supabase.rpc.mock.calls[0][0]).toBe('reissue_staff_invitation')
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ p_actor_email: 'owner@x.com', p_staff_id: 's1' })
  })

  it('rejects unknown actions and missing ids', async () => {
    const handler = createHandler({ getSupabase: () => fakeSupabase(), sendInvitation: vi.fn(), logger: quietLogger })
    expect((await run(handler, { body: { action: 'nope' } })).statusCode).toBe(400)
    expect((await run(handler, { body: { action: 'invite' } })).statusCode).toBe(400)
    expect((await run(handler, { body: { action: 'resend' } })).statusCode).toBe(400)
  })
})
