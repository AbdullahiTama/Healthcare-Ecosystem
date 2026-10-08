// CareHub's /api/auth-email has two audiences. password_reset and email_verification are public (a user locked out of
// their account is not signed in) and must not reveal which addresses have an account. staff_setup mints a real
// recovery link and sends "you have been invited to <business> as <role>", and it used to run for ANY caller with the
// business name and role taken from the request body - a convincing invitation anyone could send to any account.
// It now requires the signed-in business owner, takes the business, role and name from the database, and only for a
// person who really is on that business's staff.
const h = vi.hoisted(() => ({ sendAuthEmail: vi.fn(), client: null }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@care-ecosystem/shared-email', () => ({ sendAuthEmail: (...a) => h.sendAuthEmail(...a) }))

import handler from '../_handlers/auth-email.js'

function makeClient({
  user = { id: 'owner-1', email: 'owner@clinic.test', email_confirmed_at: '2026-01-01T00:00:00Z' },
  authError = null,
  business = { id: 'biz-1', name: 'Real Clinic' },
  staffRow = { full_name: 'Sam Staff', role: 'Pharmacist', status: 'active' },
} = {}) {
  const calls = { ilike: [], eq: [], is: [] }
  const client = {
    auth: { getUser: vi.fn(async () => (authError ? { data: { user: null }, error: authError } : { data: { user }, error: null })) },
    from: (table) => {
      const b = {}
      for (const m of ['select', 'limit']) b[m] = () => b
      b.ilike = (...a) => { calls.ilike.push([table, ...a]); return b }
      b.eq = (...a) => { calls.eq.push([table, ...a]); return b }
      b.is = (...a) => { calls.is.push([table, ...a]); return b }
      b.maybeSingle = async () => ({ data: table === 'businesses' ? business : table === 'staff' ? staffRow : null, error: null })
      return b
    },
  }
  h.client = client
  return { client, calls }
}

async function call(body, { token = null } = {}) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('AUTH_EMAIL_MIN_RESPONSE_MS', '0')
  makeClient()
  h.sendAuthEmail.mockResolvedValue({ ok: true, sent: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('public actions do not reveal whether an account exists', () => {
  it.each([
    ['an account exists', { ok: true, sent: true }],
    ['there is no such account', { ok: true, sent: false }],
    ['the address is over its rate limit', { ok: true, sent: false, limited: true }],
  ])('password_reset answers the same when %s', async (_label, outcome) => {
    h.sendAuthEmail.mockResolvedValue(outcome)

    const res = await call({ action: 'password_reset', email: 'someone@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('answers the same when sending throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.sendAuthEmail.mockRejectedValue(new Error('boom'))

    const res = await call({ action: 'email_verification', email: 'someone@example.com' })

    expect(res.body).toEqual({ ok: true })
  })

  it('takes at least the minimum response time', async () => {
    vi.stubEnv('AUTH_EMAIL_MIN_RESPONSE_MS', '150')
    const started = Date.now()

    await call({ action: 'password_reset', email: 'nobody@example.com' })

    expect(Date.now() - started).toBeGreaterThanOrEqual(140)
  })

  it.each(['customer_registration', 'delete_account', undefined])('rejects action %s', async (action) => {
    const res = await call({ action, email: 'someone@example.com' })

    expect(res.statusCode).toBe(400)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })
})

describe('staff_setup requires the signed-in business owner', () => {
  const invite = { action: 'staff_setup', email: 'sam@clinic.test', businessName: 'FAKE BANK', role: 'Admin', fullName: 'Spoofed' }

  it('rejects a request with no session', async () => {
    const res = await call(invite)

    expect(res.statusCode).toBe(401)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it('rejects a token that is not a real session', async () => {
    makeClient({ authError: { message: 'invalid JWT' } })

    const res = await call(invite, { token: 'x' })

    expect(res.statusCode).toBe(401)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it('rejects an account whose email is not confirmed', async () => {
    makeClient({ user: { id: 'u', email: 'owner@clinic.test', email_confirmed_at: null } })

    const res = await call(invite, { token: 'tok' })

    expect(res.statusCode).toBe(403)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it('rejects a signed-in user who does not own a business', async () => {
    makeClient({ business: null })

    const res = await call(invite, { token: 'tok' })

    expect(res.statusCode).toBe(403)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it('rejects an address that is not on the caller\'s staff', async () => {
    makeClient({ staffRow: null })

    const res = await call(invite, { token: 'tok' })

    expect(res.statusCode).toBe(403)
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it('sends the invitation with the business, role and name taken from the database, not the request', async () => {
    const res = await call(invite, { token: 'tok' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(h.sendAuthEmail).toHaveBeenCalledWith(expect.objectContaining({
      action: 'staff_setup',
      email: 'sam@clinic.test',
      businessName: 'Real Clinic',
      role: 'Pharmacist',
      fullName: 'Sam Staff',
      app: 'carehub',
    }))
  })

  it('looks the business up by the caller\'s email and the staff row by business and address, escaping LIKE wildcards', async () => {
    const { calls } = makeClient({ user: { id: 'u', email: 'o_w%ner@clinic.test', email_confirmed_at: '2026-01-01T00:00:00Z' } })

    await call({ ...invite, email: 'sa_m@clinic.test' }, { token: 'tok' })

    expect(calls.ilike).toContainEqual(['businesses', 'email', 'o\\_w\\%ner@clinic.test'])
    expect(calls.is).toContainEqual(['businesses', 'parent_business_id', null])
    expect(calls.eq).toContainEqual(['staff', 'business_id', 'biz-1'])
    expect(calls.ilike).toContainEqual(['staff', 'email', 'sa\\_m@clinic.test'])
  })
})
