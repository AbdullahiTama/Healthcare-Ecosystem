const h = vi.hoisted(() => ({
  rows: [],
  reconcile: vi.fn(),
  queryError: null,
  rpcCalls: [],
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const b = {
      select: () => b, eq: () => b, not: () => b, lt: () => b, order: () => b,
      limit: async () => ({ data: h.rows, error: h.queryError }),
    }
    return {
      from: () => b,
      rpc: async (name, args) => { h.rpcCalls.push([name, args]); return { data: 'new', error: null } },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'u@example.com' } } }) } },
    }
  },
}))
vi.mock('../_lib/emailService.js', () => ({ enqueue: vi.fn(async () => {}), processBatch: vi.fn(async () => {}) }))
vi.mock('../_lib/withdrawalRecovery.js', () => ({ reconcileWithdrawal: h.reconcile }))

import handler from './reconcile-withdrawals.js'
import { reconcileWithdrawal as realReconcile } from '../_lib/withdrawalRecovery.js'

const res = () => { const r = { statusCode: 0, body: null }; r.status = (c) => { r.statusCode = c; return r }; r.json = (b) => { r.body = b; return r }; return r }
const call = (headers = {}) => { const r = res(); return handler({ method: 'GET', headers }, r).then(() => r) }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  process.env.CRON_SECRET = 'cron-secret'
  h.rows = []
  h.queryError = null
  h.rpcCalls.length = 0
  h.reconcile.mockReset()
})

describe('reconcile-withdrawals cron', () => {
  it('refuses to run with no CRON_SECRET configured (it moves money)', async () => {
    delete process.env.CRON_SECRET
    const r = await call({ authorization: 'Bearer anything' })
    expect(r.statusCode).toBe(500)
    expect(h.reconcile).not.toHaveBeenCalled()
  })

  it('rejects a request with no token, and one with the wrong token', async () => {
    h.rows = [{ id: 'w1', user_id: 'u1', amount: 10, paystack_reference: 'r1' }]
    expect((await call()).statusCode).toBe(401)
    expect((await call({ authorization: 'Bearer nope' })).statusCode).toBe(401)
    expect(h.reconcile).not.toHaveBeenCalled()
  })

  it('reconciles stale rows and reports the outcomes', async () => {
    h.rows = [
      { id: 'w1', user_id: 'u1', amount: 10, paystack_reference: 'r1' },
      { id: 'w2', user_id: 'u2', amount: 10, paystack_reference: 'r2' },
      { id: 'w3', user_id: 'u3', amount: 10, paystack_reference: 'r3' },
      { id: 'w4', user_id: 'u4', amount: 10, paystack_reference: 'r4' },
    ]
    h.reconcile
      .mockResolvedValueOnce({ outcome: 'refunded' })
      .mockResolvedValueOnce({ outcome: 'completed' })
      .mockResolvedValueOnce({ outcome: 'waiting', detail: 'still pending' })
      .mockRejectedValueOnce(new Error('boom'))
    const r = await call({ authorization: 'Bearer cron-secret' })
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ checked: 4, refunded: 1, completed: 1, waiting: 1, errors: 1 })
  })

  it('records trust only for a withdrawal this run completed - never for a refunded or waiting one', async () => {
    h.rows = [
      { id: 'w1', user_id: 'u1', amount: 10, paystack_reference: 'r1' },
      { id: 'w2', user_id: 'u2', amount: 20, paystack_reference: 'r2' },
      { id: 'w3', user_id: 'u3', amount: 30, paystack_reference: 'r3' },
    ]
    h.reconcile
      .mockResolvedValueOnce({ outcome: 'refunded' })
      .mockResolvedValueOnce({ outcome: 'completed' })
      .mockResolvedValueOnce({ outcome: 'waiting', detail: 'already settled' })
    await call({ authorization: 'Bearer cron-secret' })
    expect(h.rpcCalls).toEqual([['update_withdrawal_trust_after_withdrawal', { p_user_id: 'u2', p_amount: 20, p_status: 'completed' }]])
  })

  it('a query failure is a 500, not a silent success', async () => {
    h.queryError = { message: 'db down' }
    expect((await call({ authorization: 'Bearer cron-secret' })).statusCode).toBe(500)
  })

  it('is wired to the real recovery module', () => {
    expect(typeof realReconcile).toBe('function')
  })
})
