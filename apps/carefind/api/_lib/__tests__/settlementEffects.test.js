import { describe, it, expect, vi, beforeEach } from 'vitest'

// The confirmation email after a payment settles. Two ways this used to lose the email, both silent:
//  - the flush was fire-and-forget, and a serverless function is frozen as soon as the handler responds, so the email
//    waited for the next cron (once a day in production);
//  - a failure to queue was only a console line.
const h = vi.hoisted(() => ({ enqueue: vi.fn(), processBatch: vi.fn() }))
vi.mock('../emailService.js', () => ({ enqueue: h.enqueue, processBatch: h.processBatch }))

const { runSettlementEffects } = await import('../settlementEffects.js')

function supabase({ email = 'ada@example.com' } = {}) {
  const inserts = []
  return {
    inserts,
    auth: { admin: { getUserById: async () => ({ data: { user: { email, user_metadata: { full_name: 'Ada' } } } }) } },
    from: (table) => ({
      insert: async (row) => { inserts.push([table, row]); return { error: null } },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }
}

const topup = { outcome: 'settled', purpose: 'wallet_topup', intent: { reference: 'ch_topup_1', customer_id: 'u1', expected_amount: 500000 } }

beforeEach(() => {
  h.enqueue.mockReset().mockResolvedValue({ id: 'row' })
  h.processBatch.mockReset().mockResolvedValue({ sent: 1 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('runSettlementEffects (CareFind)', () => {
  it('queues the confirmation and does not return until the outbox flush has finished', async () => {
    let flushed = false
    h.processBatch.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); flushed = true })

    await runSettlementEffects(supabase(), topup)

    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'payment_success', toEmail: 'ada@example.com', idempotencyKey: 'payment-success:ch_topup_1',
    }))
    // The point: the handler's response cannot go out before the email has been handed to the provider.
    expect(flushed).toBe(true)
  })

  it('does not hold the response hostage when the provider hangs', async () => {
    h.processBatch.mockImplementation(() => new Promise(() => {}))
    vi.useFakeTimers()
    const done = runSettlementEffects(supabase(), topup)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(done).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('a queue failure never throws into the settlement, and leaves a row in email_logs', async () => {
    h.enqueue.mockRejectedValue(new Error('Cannot find package'))
    const sb = supabase()

    await expect(runSettlementEffects(sb, topup)).resolves.toBeUndefined()

    expect(sb.inserts).toContainEqual(['email_logs', expect.objectContaining({
      event_type: 'failed', outbox_id: null, metadata: expect.objectContaining({ stage: 'enqueue', template_key: 'payment_success' }),
    })])
    // Nothing to flush when nothing was queued.
    expect(h.processBatch).not.toHaveBeenCalled()
  })

  it('does nothing for a payment this call did not settle', async () => {
    await runSettlementEffects(supabase(), { ...topup, outcome: 'already_settled' })
    expect(h.enqueue).not.toHaveBeenCalled()
  })
})
