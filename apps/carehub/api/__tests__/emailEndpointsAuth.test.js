// CareHub's email endpoints run on the service-role client. /api/email/outbox never validated the token at all
// (a non-empty string was enough to read the whole outbox, payload links included, and rewrite any row), and
// send / test-send / process-outbox accepted any signed-in user. Its only browser caller of /send is the admin referral
// panel. Every one of them now requires a platform admin, whose identity CareHub ties to a confirmed email.
const h = vi.hoisted(() => ({ client: null, enqueue: vi.fn(), processBatch: vi.fn() }))

// A stable stand-in for the lazy service-role client; each test swaps the client behind it.
vi.mock('../_lib/supabase.js', () => ({
  supabase: {
    auth: { getUser: (...a) => h.client.auth.getUser(...a) },
    from: (...a) => h.client.from(...a),
  },
}))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: (...a) => h.enqueue(...a), processBatch: (...a) => h.processBatch(...a) } }))
vi.mock('@care-ecosystem/shared-email', () => ({
  EmailService: class {
    processBatch(...a) { return h.processBatch(...a) }
  },
  isValidEmail: (v) => typeof v === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v),
  getTemplate: (key, app) => (app === 'carehub' && ['agent_approved', 'business_approved'].includes(key) ? () => '' : null),
}))

import outbox from '../_handlers/email-outbox.js'
import testSend from '../_handlers/email-test-send.js'
import send from '../_handlers/email-send.js'
import processOutbox from '../_handlers/email-process-outbox.js'

function makeClient({ user = { id: 'u1', email: 'boss@carehub.test', email_confirmed_at: '2026-01-01T00:00:00Z' }, authError = null, isAdmin = true, rows = [{ id: 'r1' }] } = {}) {
  const touched = []
  const calls = {}
  const client = {
    auth: { getUser: vi.fn(async () => (authError ? { data: { user: null }, error: authError } : { data: { user }, error: null })) },
    from: (table) => {
      touched.push(table)
      const b = {}
      const rec = (m) => (...a) => { (calls[m] ||= []).push(a); return b }
      for (const m of ['select', 'eq', 'order', 'gte', 'lte', 'update', 'ilike', 'limit']) b[m] = rec(m)
      b.range = (...a) => { calls.range = a; return b }
      b.single = async () => ({ data: { id: 'r1' }, error: null })
      b.then = (resolve) => resolve(table === 'businesses' ? { data: isAdmin ? [{ id: 'biz-admin' }] : [], error: null } : { data: rows, count: rows.length, error: null })
      return b
    },
  }
  h.client = client
  return { touched, calls, client }
}

async function call(handler, { method = 'GET', token = 'valid-token', body, query = {} } = {}) {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method, headers: token === null ? {} : { authorization: `Bearer ${token}` }, body, query, url: '/api/email/x' }, res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.enqueue.mockResolvedValue({ id: 'outbox-1' })
  h.processBatch.mockResolvedValue({ processed: 0 })
})

const ENDPOINTS = [
  ['outbox (GET)', outbox, { method: 'GET' }],
  ['outbox (POST)', outbox, { method: 'POST', body: { id: 'r1', status: 'pending' } }],
  ['test-send', testSend, { method: 'POST', body: { templateKey: 'agent_approved', toEmail: 'victim@example.com' } }],
  ['send', send, { method: 'POST', body: { templateKey: 'agent_approved', toEmail: 'victim@example.com', payload: { agentName: 'A', agentEmail: 'victim@example.com' } } }],
  ['process-outbox', processOutbox, { method: 'POST' }],
]

describe.each(ENDPOINTS)('%s requires a platform admin', (_name, handler, req) => {
  it('rejects a request with no token', async () => {
    const { touched } = makeClient()

    const res = await call(handler, { ...req, token: null })

    expect(res.statusCode).toBe(401)
    expect(touched).not.toContain('email_outbox')
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.processBatch).not.toHaveBeenCalled()
  })

  it('rejects a token that is not a real session', async () => {
    const { touched } = makeClient({ authError: { message: 'invalid JWT' } })

    const res = await call(handler, { ...req, token: 'x' })

    expect(res.statusCode).toBe(401)
    expect(touched).not.toContain('email_outbox')
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.processBatch).not.toHaveBeenCalled()
  })

  it('rejects a signed-in user who is not a platform admin', async () => {
    const { touched } = makeClient({ isAdmin: false })

    const res = await call(handler, req)

    expect(res.statusCode).toBe(403)
    expect(touched).not.toContain('email_outbox')
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.processBatch).not.toHaveBeenCalled()
  })

  it('rejects an admin address whose email has not been confirmed', async () => {
    const { touched } = makeClient({ user: { id: 'u2', email: 'boss@carehub.test', email_confirmed_at: null } })

    const res = await call(handler, req)

    expect(res.statusCode).toBe(403)
    expect(touched).not.toContain('email_outbox')
    expect(h.enqueue).not.toHaveBeenCalled()
  })
})

describe('admin identity lookup', () => {
  it('escapes LIKE wildcards so a crafted address cannot match an admin by pattern', async () => {
    const { calls } = makeClient({ user: { id: 'u3', email: 'a_b%c@carehub.test', email_confirmed_at: '2026-01-01T00:00:00Z' } })

    await call(outbox, { method: 'GET' })

    expect(calls.ilike).toContainEqual(['email', 'a\\_b\\%c@carehub.test'])
    expect(calls.eq).toContainEqual(['is_platform_admin', true])
  })
})

describe('outbox as an admin', () => {
  it('lists emails and clamps pagination to sane bounds', async () => {
    const { calls } = makeClient()

    const res = await call(outbox, { method: 'GET', query: { limit: '100000', offset: '-5' } })

    expect(res.statusCode).toBe(200)
    expect(calls.range).toEqual([0, 99])
  })

  it('only allows moving a row to a recognised status', async () => {
    makeClient()

    const bad = await call(outbox, { method: 'POST', body: { id: 'r1', status: 'sent' } })
    const ok = await call(outbox, { method: 'POST', body: { id: 'r1', status: 'pending' } })

    expect(bad.statusCode).toBe(400)
    expect(ok.statusCode).toBe(200)
  })
})

describe('test-send as an admin', () => {
  it('rejects a template that does not exist for CareHub', async () => {
    makeClient()

    const res = await call(testSend, { method: 'POST', body: { templateKey: 'constructor', toEmail: 'a@example.com' } })

    expect(res.statusCode).toBe(400)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a malformed recipient', async () => {
    makeClient()

    const res = await call(testSend, { method: 'POST', body: { templateKey: 'agent_approved', toEmail: 'nope' } })

    expect(res.statusCode).toBe(400)
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('queues a test email', async () => {
    makeClient()

    const res = await call(testSend, { method: 'POST', body: { templateKey: 'agent_approved', toEmail: 'a@example.com' } })

    expect(res.statusCode).toBe(202)
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'agent_approved', toEmail: 'a@example.com' }))
  })
})

describe('send and process-outbox as an admin', () => {
  it('send queues a catalogued template', async () => {
    makeClient()

    const res = await call(send, { method: 'POST', body: { templateKey: 'agent_approved', toEmail: 'a@example.com', payload: { agentName: 'A', agentEmail: 'a@example.com' } } })

    expect(res.statusCode).toBe(202)
    expect(h.enqueue).toHaveBeenCalled()
  })

  it('process-outbox drains a batch', async () => {
    makeClient()

    const res = await call(processOutbox, { method: 'POST' })

    expect(res.statusCode).toBe(200)
    expect(h.processBatch).toHaveBeenCalledTimes(1)
  })
})
