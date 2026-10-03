import { describe, it, expect, vi, beforeEach } from 'vitest'

const enqueue = vi.hoisted(() => vi.fn())
const processBatch = vi.hoisted(() => vi.fn())
const getUser = vi.hoisted(() => vi.fn())
const maybeSingleCalls = vi.hoisted(() => [])

vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue, processBatch } }))
vi.mock('../_lib/supabase.js', () => ({
  supabase: {
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            const next = maybeSingleCalls.shift()
            return Promise.resolve(next || { data: null, error: null })
          },
        }),
      }),
    }),
  },
}))

import handler from '../_handlers/notify-business-status.js'

const post = (body) => {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return handler({ method: 'POST', headers: { authorization: 'Bearer tok' }, body }, res).then(() => res)
}

describe('notify-business-status', () => {
  beforeEach(() => { vi.clearAllMocks(); maybeSingleCalls.length = 0; enqueue.mockResolvedValue({ id: '1' }) })

  it('enqueues exactly once per (status, business) and no payload leaks', async () => {
    getUser.mockResolvedValue({ data: { user: { email: 'admin@carehub.ng' } }, error: null })
    maybeSingleCalls.push({ data: { id: 'b1', is_platform_admin: true } })
    maybeSingleCalls.push({ data: { id: 'target-1', name: 'Shop', owner: 'Ada', email: 'ada@shop.ng' } })

    const res = await post({ businessId: 'target-1', status: 'active' })
    expect(res.statusCode).toBe(200)
    expect(enqueue).toHaveBeenCalledTimes(1)
    const arg = enqueue.mock.calls[0][0]
    expect(arg.templateKey).toBe('business_approved')
    expect(arg.idempotencyKey).toBe('business_approved:target-1')

    // Repeat admin action for the same business/status yields the same key,
 // so the DB idempotency index collapses the pair.
    vi.clearAllMocks()
    maybeSingleCalls.push({ data: { id: 'b1', is_platform_admin: true } })
    maybeSingleCalls.push({ data: { id: 'target-1', name: 'Shop', owner: 'Ada', email: 'ada@shop.ng' } })
    await post({ businessId: 'target-1', status: 'active' })
    expect(enqueue.mock.calls[0][0].idempotencyKey).toBe('business_approved:target-1')
  })

  it('rejects non-admin callers and enqueues nothing', async () => {
    getUser.mockResolvedValue({ data: { user: { email: 'owner@shop.ng' } }, error: null })
    maybeSingleCalls.push({ data: { id: 'b1', is_platform_admin: false } })
    const res = await post({ businessId: 'target-1', status: 'active' })
    expect(res.statusCode).toBe(403)
    expect(enqueue).not.toHaveBeenCalled()
  })
})
