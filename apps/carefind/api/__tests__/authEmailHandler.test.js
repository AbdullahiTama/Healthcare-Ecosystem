// /api/auth-email is reachable without a session, so what it returns must not tell a stranger which addresses have an
// account. It used to answer { ok: true, sent: true | false } where sent: false meant "no such account", and it
// forwarded any action (including staff_setup) to the shared sender.
const h = vi.hoisted(() => ({ sendAuthEmail: vi.fn(), createClient: vi.fn(() => ({ from: () => ({}) })) }))

vi.mock('@supabase/supabase-js', () => ({ createClient: (...a) => h.createClient(...a) }))
vi.mock('@care-ecosystem/shared-email', () => ({ sendAuthEmail: (...a) => h.sendAuthEmail(...a) }))

import handler from '../_handlers/auth-email.js'

async function call(body) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method: 'POST', headers: {}, body }, res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('AUTH_EMAIL_MIN_RESPONSE_MS', '0')
})
afterEach(() => vi.unstubAllEnvs())

describe('auth-email response does not reveal whether an account exists', () => {
  it.each([
    ['an account exists', { ok: true, sent: true }],
    ['there is no such account', { ok: true, sent: false }],
    ['the address is over its rate limit', { ok: true, sent: false, limited: true }],
  ])('answers the same when %s', async (_label, outcome) => {
    h.sendAuthEmail.mockResolvedValue(outcome)

    const res = await call({ action: 'password_reset', email: 'someone@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('answers the same when sending throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.sendAuthEmail.mockRejectedValue(new Error('boom'))

    const res = await call({ action: 'email_verification', email: 'someone@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('takes at least the minimum response time, so an existing account is not slower than an unknown one', async () => {
    vi.stubEnv('AUTH_EMAIL_MIN_RESPONSE_MS', '150')
    h.sendAuthEmail.mockResolvedValue({ ok: true, sent: false })
    const started = Date.now()

    await call({ action: 'password_reset', email: 'nobody@example.com' })

    expect(Date.now() - started).toBeGreaterThanOrEqual(140)
  })
})

describe('auth-email accepts only the actions CareFind needs', () => {
  it.each(['staff_setup', 'delete_account', '', undefined])('rejects action %s', async (action) => {
    const res = await call({ action, email: 'someone@example.com' })

    expect(res.statusCode).toBe(400)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it.each(['password_reset', 'email_verification', 'customer_registration'])('accepts %s', async (action) => {
    h.sendAuthEmail.mockResolvedValue({ ok: true, sent: true })

    const res = await call({ action, email: 'someone@example.com', fullName: 'Ada' })

    expect(res.statusCode).toBe(200)
    expect(h.sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({ action, email: 'someone@example.com', app: 'carefind' }))
  })

  it('rejects a malformed address', async () => {
    const res = await call({ action: 'password_reset', email: 'not-an-email' })

    expect(res.statusCode).toBe(400)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })
})
