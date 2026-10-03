// This handler is now a thin, auth-gated wrapper over sweepWithdrawals() (the per-row logic -
// outcome counting, trust recording, notify-on-refund - is tested directly in
// _lib/__tests__/withdrawalRecovery.test.js). Here we only test the gating and delegation.
const h = vi.hoisted(() => ({ sweep: vi.fn(async () => ({ checked: 0, refunded: 0, completed: 0, waiting: 0, errors: 0 })) }))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ marker: 'the-client' }) }))
vi.mock('../_lib/withdrawalRecovery.js', () => ({ sweepWithdrawals: h.sweep }))

import handler from './reconcile-withdrawals.js'

const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = (headers = {}) => { const r = res(); return handler({ method: 'GET', headers }, r).then(() => r) }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.CRON_SECRET = 'cron-secret'
  h.sweep.mockClear()
})

describe('reconcile-withdrawals cron (standalone endpoint)', () => {
  it('refuses to run with no CRON_SECRET configured (it moves money)', async () => {
    delete process.env.CRON_SECRET
    const r = await call({ authorization: 'Bearer anything' })
    expect(r.statusCode).toBe(500)
    expect(h.sweep).not.toHaveBeenCalled()
  })

  it('rejects a request with no token, and one with the wrong token', async () => {
    expect((await call()).statusCode).toBe(401)
    expect((await call({ authorization: 'Bearer nope' })).statusCode).toBe(401)
    expect(h.sweep).not.toHaveBeenCalled()
  })

  it('runs the sweep and returns its summary', async () => {
    h.sweep.mockResolvedValue({ checked: 3, refunded: 1, completed: 1, waiting: 1, errors: 0 })
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ checked: 3, refunded: 1, completed: 1, waiting: 1, errors: 0 })
    expect(h.sweep).toHaveBeenCalledWith({ marker: 'the-client' })
  })

  it('a sweep failure is a 500, not a silent success', async () => {
    h.sweep.mockRejectedValue(new Error('db down'))
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(500)
    expect(r.body.error).toBe('db down')
  })
})
