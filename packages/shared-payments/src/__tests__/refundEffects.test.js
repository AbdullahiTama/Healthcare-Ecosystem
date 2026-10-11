import { describe, it, expect, vi } from 'vitest'
import { createRefundEffects } from '../refundEffects.js'

// The best-effort email AFTER a refund flips to completed: the payer learns their money is on its way, branded by
// the app that owns the original charge, exactly once per refund. Recipient (payer) and brand both come from the
// refund's entity; a webhook, the cancel path and the cron sweep all funnel through this single effect, and nothing
// here may ever throw into a settle that already committed.
function fake({ appt, intent, authUser = null, authThrows = false, throws = false } = {}) {
  return {
    auth: {
      admin: {
        getUserById: async () => {
          if (authThrows) throw new Error('auth down')
          return authUser ? { data: { user: authUser }, error: null } : { data: null, error: { message: 'not found' } }
        },
      },
    },
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (throws) throw new Error('db down')
          const row = table === 'appointments' ? (appt ?? null) : table === 'payment_intents' ? (intent ?? null) : null
          return { data: row, error: null }
        },
      }
      return b
    },
  }
}

const settled = (result, over = {}) => ({
  id: 'rf1', reference: 'rf_abc', kind: 'card', entity_type: 'appointment', entity_id: 'a1',
  amount_kobo: 1000000, customer_id: null, from_status: 'processing', result, ...over,
})

function setup(opts = {}, send) {
  const sent = []
  const logger = { error: vi.fn() }
  const apply = createRefundEffects({ supabase: fake(opts), send: send || (async (m) => { sent.push(m) }), logger })
  return { apply, sent, logger }
}

describe('createRefundEffects', () => {
  it('completed for a CareFind appointment: the client gets the refund email, branded carefind, keyed by the refund id', async () => {
    const { apply, sent } = setup({ appt: { client_email: 'client@example.com', client_name: 'Chidi', source: 'carefind' } })
    await apply(settled('completed'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      templateKey: 'refund_completed', toEmail: 'client@example.com', app: 'carefind',
      subject: 'CareFind: refund completed', sourceId: 'rf1', idempotencyKey: 'refund-completed:rf1',
    })
    expect(sent[0].payload).toMatchObject({ fullName: 'Chidi', reference: 'rf_abc' })
    expect(sent[0].payload.amount).toContain('10,000')
  })

  it('a CareHub appointment: carehub brand and subject; the payer from auth wins over the appointment copy', async () => {
    const { apply, sent } = setup({
      authUser: { email: 'payer@example.com', user_metadata: { full_name: 'Amaka' } },
      appt: { client_email: 'old@example.com', client_name: 'Old', source: 'carehub' },
    })
    await apply(settled('completed', { customer_id: 'u1' }))
    expect(sent[0]).toMatchObject({ toEmail: 'payer@example.com', app: 'carehub', subject: 'CareHub: refund completed' })
    expect(sent[0].payload.fullName).toBe('Amaka')
  })

  it('a payment_intent refund takes its brand from the intent and falls back to "there"', async () => {
    const { apply, sent } = setup({ intent: { application: 'carehub' }, authUser: { email: 'c@example.com', user_metadata: {} } })
    await apply(settled('completed', { entity_type: 'payment_intent', entity_id: 'i1', customer_id: 'u2' }))
    expect(sent[0]).toMatchObject({ app: 'carehub', toEmail: 'c@example.com', subject: 'CareHub: refund completed' })
    expect(sent[0].payload.fullName).toBe('there')
  })

  it('results that changed nothing (replays, still-processing, not_found) send nothing', async () => {
    const { apply, sent } = setup({ appt: { client_email: 'c@example.com', client_name: 'C', source: 'carefind' } })
    for (const r of ['already_completed', 'already_failed', 'processing', 'not_found', 'amount_mismatch', undefined]) await apply(settled(r))
    expect(sent).toEqual([])
  })

  it('a refund the provider failed tells the payer once: refund_failed, keyed by the refund id, same brand rule', async () => {
    const { apply, sent } = setup({ appt: { client_email: 'c@example.com', client_name: 'Chidi', source: 'carehub' } })
    await apply(settled('failed'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      templateKey: 'refund_failed', toEmail: 'c@example.com', app: 'carehub', sourceId: 'rf1',
      subject: 'CareHub: refund needs attention', idempotencyKey: 'refund-failed:rf1',
    })
    expect(sent[0].payload).toMatchObject({ fullName: 'Chidi', reference: 'rf_abc' })
  })

  it('a requested refund tells the payer why, for an appointment and for a payment that could not be applied', async () => {
    const appt = setup({ appt: { client_email: 'c@example.com', client_name: 'C', source: 'carefind', patient_user_id: null } })
    await appt.apply(settled('requested', { customer_id: undefined, amount_kobo: 250000 }))
    expect(appt.sent[0]).toMatchObject({ templateKey: 'refund_requested', app: 'carefind', idempotencyKey: 'refund-requested:rf1', subject: 'CareFind: refund requested' })
    expect(appt.sent[0].payload).toMatchObject({ reason: 'Appointment cancelled' })
    expect(appt.sent[0].payload.amount).toContain('2,500')

    const intent = setup({ intent: { application: 'carefind', customer_id: 'u1' }, authUser: { email: 'p@example.com', user_metadata: { full_name: 'Pat' } } })
    await intent.apply(settled('requested', { entity_type: 'payment_intent', entity_id: 'i1' }))
    expect(intent.sent[0]).toMatchObject({ toEmail: 'p@example.com', templateKey: 'refund_requested' })
    expect(intent.sent[0].payload).toMatchObject({ fullName: 'Pat', reason: 'Your payment could not be applied' })
  })

  it('requested, then completed, are two emails with two different keys; a replay of either changes nothing downstream', async () => {
    const { apply, sent } = setup({ appt: { client_email: 'c@example.com', client_name: 'C', source: 'carefind' } })
    await apply(settled('requested'))
    await apply(settled('completed'))
    expect(sent.map((m) => m.idempotencyKey)).toEqual(['refund-requested:rf1', 'refund-completed:rf1'])
    await apply(settled('requested'))
    await apply(settled('completed'))
    // the same keys again: the outbox's unique key makes these no-ops (asserted in the EmailService suite)
    expect(new Set(sent.map((m) => m.idempotencyKey)).size).toBe(2)
  })

  it('a CareCoin refund (no kobo) is described in coins, not as N0', async () => {
    const { apply, sent } = setup({ appt: { client_email: 'c@example.com', client_name: 'C', source: 'carefind' } })
    await apply(settled('completed', { kind: 'carecoin', amount_kobo: null, coins: 5 }))
    expect(sent[0].payload.amount).toBe('5 CareCoins')
  })

  it('an enqueue that fails is logged as email.enqueue_failed without the address, never thrown', async () => {
    const { apply, logger } = setup({ appt: { client_email: 'c@example.com', client_name: 'C', source: 'carefind' } }, async () => { throw new Error('outbox rejected c@example.com') })
    await expect(apply(settled('completed'))).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith('email.enqueue_failed', expect.objectContaining({ family: 'refund', template: 'refund_completed', id: 'rf1' }))
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('c@example.com')
  })

  it('no address anywhere: nothing is sent, nothing throws, and it is logged', async () => {
    const { apply, sent, logger } = setup({ appt: { client_email: null, client_name: 'C', source: 'carefind' } })
    await expect(apply(settled('completed'))).resolves.toBeUndefined()
    expect(sent).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })

  it('an auth lookup that throws falls back to the appointment address', async () => {
    const { apply, sent } = setup({ authThrows: true, appt: { client_email: 'fallback@example.com', client_name: 'F', source: 'carefind' } })
    await apply(settled('completed', { customer_id: 'u1' }))
    expect(sent[0].toEmail).toBe('fallback@example.com')
  })

  it('a database error and a send that throws are both swallowed: the settle never fails', async () => {
    const { apply, logger } = setup({ throws: true })
    await expect(apply(settled('completed'))).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
    const { apply: apply2, logger: logger2 } = setup(
      { appt: { client_email: 'c@example.com', client_name: 'C', source: 'carefind' } },
      async () => { throw new Error('smtp down') },
    )
    await expect(apply2(settled('completed'))).resolves.toBeUndefined()
    expect(logger2.error).toHaveBeenCalled()
  })

  it('no id in the result: nothing is sent', async () => {
    const { apply, sent } = setup({ appt: { client_email: 'c@example.com', client_name: 'C', source: 'carefind' } })
    await apply({ result: 'completed' })
    expect(sent).toEqual([])
  })
})
