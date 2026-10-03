import { describe, it, expect, vi, beforeEach } from 'vitest'

// The product doesn't have generic end-to-end email mocks, so this proves the
// guard that matters at hand-off time: handlers must never reach the outbox
// when the business action itself failed.

const enqueueMock = vi.hoisted(() => vi.fn())
vi.mock('../_lib/emailService.js', () => ({
  enqueue: enqueueMock,
  processBatch: vi.fn(async () => ({ processed: 0, sent: 0, failed: 0 })),
}))

const appointmentsResult = vi.hoisted(() => ({ data: null, error: null }))
const table = () => {
  const t = {
    select: () => t,
    update: () => t,
    eq: () => t,
    in: () => t,
    maybeSingle: async () => appointmentsResult,
  }
  return t
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => table(),
    rpc: async () => ({ data: null, error: null }),
  }),
}))

import handler from '../_handlers/cancel-appointment.js'

const call = async (body) => {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  await handler({ method: 'POST', body, headers: {} }, res)
  return res
}

describe('cancel-appointment email side effects', () => {
  beforeEach(() => { enqueueMock.mockClear(); appointmentsResult.data = null; appointmentsResult.error = null })

  it('does not enqueue an email when the appointment does not exist', async () => {
    appointmentsResult.data = null
    appointmentsResult.error = { message: 'not found' }
    const res = await call({ appointment_id: 'appt-1', cancelled_by: 'owner' })
    expect(res.statusCode).toBe(404)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('does not enqueue an email for an already-cancelled appointment', async () => {
    appointmentsResult.data = { id: 'appt-1', status: 'cancelled', payment_status: 'paid', fee_amount: 100, business_id: 'b1', client_name: 'X', date: '2030-01-01', time: '10:00' }
    const res = await call({ appointment_id: 'appt-1', cancelled_by: 'owner' })
    expect(res.statusCode).toBe(400)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
