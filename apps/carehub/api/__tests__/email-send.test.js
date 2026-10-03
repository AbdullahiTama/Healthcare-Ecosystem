import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.hoisted(() => vi.fn())
const enqueue = vi.hoisted(() => vi.fn())
const processBatch = vi.hoisted(() => vi.fn())

vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue, processBatch } }))
// The endpoint requires a platform admin, so the stand-in client also answers the businesses lookup that proves it.
const adminLookup = vi.hoisted(() => ({ rows: [{ id: 'biz-admin' }] }))
vi.mock('../_lib/supabase.js', () => ({
  supabase: {
    auth: { getUser },
    from: () => {
      const b = {}
      for (const m of ['select', 'ilike', 'eq', 'limit']) b[m] = () => b
      b.then = (resolve) => resolve({ data: adminLookup.rows, error: null })
      return b
    },
  },
}))

import handler from '../_handlers/email-send.js'

const call = async (req) => {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  await handler(req, res)
  return res
}
const post = (body, headers = { authorization: 'Bearer tok' }) => call({ method: 'POST', headers, body })

const valid = { templateKey: 'business_approved', toEmail: 'owner@example.com', payload: { businessName: 'X', ownerName: 'Y', ownerEmail: 'o@e.com' }, subject: 'Hi' }

describe('POST /api/email/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminLookup.rows = [{ id: 'biz-admin' }]
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'admin@carehub.test', email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null })
    enqueue.mockResolvedValue({ id: 'row-1' })
    processBatch.mockResolvedValue({ processed: 1, sent: 1, failed: 0 })
  })

  it('rejects non-POST', async () => {
    expect((await call({ method: 'GET', headers: {}, body: {} })).statusCode).toBe(405)
  })

  it('rejects missing/invalid auth', async () => {
    expect((await post(valid, {})).statusCode).toBe(401)
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('bad') })
    expect((await post(valid)).statusCode).toBe(401)
  })

  it('rejects arbitrary html/to/subject without a templateKey', async () => {
    const res = await post({ to: 'x@y.com', subject: 's', html: '<p>x</p>' })
    expect(res.statusCode).toBe(400)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('rejects an unknown templateKey', async () => {
    const res = await post({ templateKey: 'arbitrary_template', toEmail: 'a@b.com', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/Invalid templateKey/)
  })

  it('rejects invalid recipient and missing payload fields', async () => {
    expect((await post({ templateKey: 'business_approved', toEmail: 'not-an-email', payload: {} })).statusCode).toBe(400)
    const res = await post({ templateKey: 'business_approved', toEmail: 'a@b.com', payload: { businessName: 'X' } })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/payload.ownerName/)
  })

  it('rejects payloads carrying credentials', async () => {
    for (const payload of [
      { clientName: 'A', businessName: 'B', amount: '₦1', password: 'x' },
      { clientName: 'A', businessName: 'B', amount: '₦1', nested: { setupToken: 'abc' } },
      { clientName: 'A', businessName: 'B', amount: '₦1', refresh_token: 'x' },
    ]) {
      const res = await post({ templateKey: 'credit_reminder', toEmail: 'a@b.com', payload })
      expect(res.statusCode).toBe(400)
      expect(res.body.error).toMatch(/credentials/)
    }
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('accepts credit_reminder, agent_approved, agent_rejected, staff_welcome', async () => {
    for (const [templateKey, payload] of [
      ['credit_reminder', { clientName: 'A', businessName: 'B', amount: '₦1,000' }],
      ['agent_approved', { agentName: 'A', agentEmail: 'a@b.com' }],
      ['agent_rejected', { agentName: 'A' }],
      ['staff_welcome', { fullName: 'A', businessName: 'B' }],
    ]) {
      const res = await post({ templateKey, toEmail: 'a@b.com', payload })
      expect(res.statusCode).toBe(202)
    }
    expect(enqueue).toHaveBeenCalledTimes(4)
  })

  it('enqueues and returns 202 without waiting for send', async () => {
    processBatch.mockReturnValue(new Promise(() => {}))
    const res = await post(valid)
    expect(res.statusCode).toBe(202)
    expect(res.body).toEqual({ ok: true, outboxId: 'row-1' })
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ templateKey: 'business_approved', toEmail: 'owner@example.com' }))
  })
})
