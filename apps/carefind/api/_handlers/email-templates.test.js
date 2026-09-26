const harness = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({ createClient: harness.createClient }))

import handler from './email-templates.js'

function makeHarness({ user = { id: 'user-1', email: 'admin@example.com' }, authError = null, admin = { id: 'admin-1', email: 'admin@example.com', role: 'super_admin', is_active: true } } = {}) {
  const getUser = vi.fn(async token => {
    expect(token).toBe('valid-auth-token')
    return { data: { user }, error: authError }
  })
  const maybeSingle = vi.fn(async () => ({ data: admin, error: null }))
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  }))
  harness.createClient.mockReturnValue({ auth: { getUser }, from })
  return { getUser, from }
}

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
}

async function invoke({ authorization, body = { action: 'create' } } = {}) {
  const res = response()
  await handler({ method: 'POST', headers: authorization ? { authorization } : {}, body }, res)
  return res
}

describe('email-templates authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects a missing bearer session before querying admin rows', async () => {
    const mock = makeHarness()
    const res = await invoke()

    expect(res.statusCode).toBe(401)
    expect(mock.getUser).not.toHaveBeenCalled()
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('rejects an invalid Supabase session', async () => {
    const mock = makeHarness({ authError: new Error('invalid jwt') })
    const res = await invoke({ authorization: 'Bearer valid-auth-token' })

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('Invalid or expired session')
    expect(mock.from).not.toHaveBeenCalled()
  })

  it('ignores a forged token in the body and requires an active database admin', async () => {
    const mock = makeHarness()
    const res = await invoke({
      authorization: 'Bearer valid-auth-token',
      body: { action: 'create', token: 'forged-base64-super-admin-token' },
    })

    expect(mock.getUser).toHaveBeenCalledTimes(1)
    expect(mock.from).toHaveBeenCalledWith('admin_users')
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('name, slug, subject and html_body are required')
  })
})
