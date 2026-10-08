// The email admin endpoints run on the service-role client, so they must authenticate the caller properly.
// /api/email/outbox used to accept ANY non-empty bearer string ("For now, we accept any valid bearer token") and
// returned the whole outbox - every recipient and payload, including live password-reset links - and let the caller
// rewrite any row's status. /api/email/send and /api/email/test-send let any signed-in user mail any address from the
// trusted sender, with a caller-chosen subject. All of them now require an active admin.
const h = vi.hoisted(() => ({ createClient: vi.fn(), enqueue: vi.fn(), processBatch: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))
vi.mock('@care-ecosystem/shared-email', () => ({
  EmailService: class {
    enqueue(...a) { return h.enqueue(...a) }
    processBatch(...a) { return h.processBatch(...a) }
  },
  TEMPLATE_REGISTRY: { password_reset: () => '', order_confirmation: () => '', welcome: () => '' },
  isValidEmail: (v) => typeof v === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v),
}))

import outbox from '../email/outbox.js'
import testSend from '../email/test-send.js'
import send from '../email/send.js'

// Records which tables were touched so a test can prove data was never read for a rejected caller.
function makeSupabase({ user = { id: 'auth-1', email: 'someone@example.com' }, authError = null, admin = { id: 'adm-1', role: 'super_admin', is_active: true }, rows = [{ id: 'r1' }] } = {}) {
  const touched = []
  const filters = {}
  const client = {
    auth: { getUser: vi.fn(async () => (authError ? { data: { user: null }, error: authError } : { data: { user }, error: null })) },
    from: (table) => {
      touched.push(table)
      const b = {}
      for (const m of ['select', 'eq', 'order', 'gte', 'lte', 'update']) b[m] = (...a) => { (filters[m] ||= []).push(a); return b }
      b.range = (...a) => { filters.range = a; return b }
      b.single = async () => ({ data: { id: 'r1' }, error: null })
      b.maybeSingle = async () => ({ data: table === 'admin_users' ? admin : null, error: null })
      b.then = (resolve) => resolve({ data: rows, count: rows.length, error: null })
      return b
    },
  }
  h.createClient.mockReturnValue(client)
  return { client, touched, filters }
}

async function call(handler, { method = 'GET', token = 'valid-token', body, query = {} } = {}) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method, headers: token === null ? {} : { authorization: `Bearer ${token}` }, body, query }, res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  h.enqueue.mockResolvedValue({ id: 'outbox-1' })
  h.processBatch.mockResolvedValue({})
})
afterEach(() => vi.unstubAllEnvs())

const ENDPOINTS = [
  ['outbox (GET)', outbox, { method: 'GET' }],
  ['outbox (POST)', outbox, { method: 'POST', body: { id: 'r1', status: 'pending' } }],
  ['test-send', testSend, { method: 'POST', body: { templateKey: 'welcome', toEmail: 'victim@example.com' } }],
  ['send', send, { method: 'POST', body: { templateKey: 'password_reset', toEmail: 'victim@example.com', payload: { fullName: 'x', resetLink: 'https://evil.example' } } }],
]

describe.each(ENDPOINTS)('%s requires an active admin', (_name, handler, req) => {
  it('rejects a request with no token', async () => {
    const { touched } = makeSupabase()

    const res = await call(handler, { ...req, token: null })

    expect(res.statusCode).toBe(401)
    expect(touched).not.toContain('email_outbox')
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a token that is not a real session, without reading or sending anything', async () => {
    const { touched } = makeSupabase({ authError: { message: 'invalid JWT' } })

    const res = await call(handler, { ...req, token: 'x' })

    expect(res.statusCode).toBe(401)
    expect(touched).not.toContain('email_outbox')
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a signed-in user who is not an admin', async () => {
    const { touched } = makeSupabase({ admin: null })

    const res = await call(handler, req)

    expect(res.statusCode).toBe(403)
    expect(touched).not.toContain('email_outbox')
    expect(h.enqueue).not.toHaveBeenCalled()
  })
})

describe('outbox as an admin', () => {
  it('lists emails and clamps pagination to sane bounds', async () => {
    const { filters } = makeSupabase()

    const res = await call(outbox, { method: 'GET', query: { limit: '100000', offset: '-5' } })

    expect(res.statusCode).toBe(200)
    expect(filters.range).toEqual([0, 99])
  })

  it('only allows moving a row to a recognised status', async () => {
    makeSupabase()

    const bad = await call(outbox, { method: 'POST', body: { id: 'r1', status: 'sent' } })
    const ok = await call(outbox, { method: 'POST', body: { id: 'r1', status: 'pending' } })

    expect(bad.statusCode).toBe(400)
    expect(ok.statusCode).toBe(200)
  })
})

describe('test-send as an admin', () => {
  it('rejects a template that does not exist', async () => {
    makeSupabase()

    const res = await call(testSend, { method: 'POST', body: { templateKey: 'constructor', toEmail: 'a@example.com' } })

    expect(res.statusCode).toBe(400)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a malformed recipient', async () => {
    makeSupabase()

    const res = await call(testSend, { method: 'POST', body: { templateKey: 'welcome', toEmail: 'not an address' } })

    expect(res.statusCode).toBe(400)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('queues a test email', async () => {
    makeSupabase()

    const res = await call(testSend, { method: 'POST', body: { templateKey: 'welcome', toEmail: 'a@example.com' } })

    expect(res.statusCode).toBe(202)
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'welcome', toEmail: 'a@example.com' }))
  })
})

describe('send as an admin', () => {
  it('rejects a malformed recipient', async () => {
    makeSupabase()

    const res = await call(send, { method: 'POST', body: { templateKey: 'password_reset', toEmail: 'nope' } })

    expect(res.statusCode).toBe(400)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('queues an allowed template', async () => {
    makeSupabase()

    const res = await call(send, { method: 'POST', body: { templateKey: 'order_confirmation', toEmail: 'a@example.com', payload: { orderRef: 'CF-1' } } })

    expect(res.statusCode).toBe(202)
    expect(h.enqueue).toHaveBeenCalled()
  })
})
