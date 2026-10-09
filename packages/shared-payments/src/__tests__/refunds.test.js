import { describe, it, expect, vi } from 'vitest'
import { ProviderError } from '../errors.js'
import { requestRefund, settleRefund, executeCardRefund, settleRefundWebhook, sweepRefunds, refundUnappliedPayments, refundCancelledAppointments, runRefundSweeps, REFUND_GRACE_MS } from '../refunds.js'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const old = new Date(NOW - 30 * 60 * 1000).toISOString()
const refund = { id: 'rf1', reference: 'rf_abc', amount_kobo: 1000000, provider_transaction_reference: 'chapp_1_abcdefgh' }
const quiet = { error: vi.fn(), warn() {} }
const perr = (over) => new ProviderError({ code: 'provider_rejected', message: 'nope', operation: 'refundPayment', ...over })

// A fake supabase whose rpc() answers per function name (a value or a function of the args), with a table for sweeps.
const fake = (answers = {}, tables = {}) => {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args])
      const a = answers[name]
      const v = typeof a === 'function' ? a(args) : a
      return v?.error ? v : { data: v ?? { result: 'not_found' }, error: null }
    },
    from: (table) => {
      const chain = { select: () => chain, in: () => chain, eq: () => chain, lt: () => chain, order: () => chain, limit: async () => ({ data: tables[table] || [], error: null }) }
      return chain
    },
  }
}
const rpcs = (s, n) => s.calls.filter(([name]) => name === n).map(([, a]) => a)

describe('requestRefund / settleRefund', () => {
  it('pass exactly what the database needs; exactly one of id/reference identifies the refund', async () => {
    const s = fake({ request_refund: { outcome: 'requested', id: 'x' }, settle_refund: { result: 'completed' } })
    expect(await requestRefund(s, { cause: 'booking_cancelled', entityType: 'appointment', entityId: 'a1', requestedBy: 'u1', reason: 'r' })).toEqual({ outcome: 'requested', id: 'x' })
    expect(s.calls[0]).toEqual(['request_refund', { p_cause: 'booking_cancelled', p_entity_type: 'appointment', p_entity_id: 'a1', p_requested_by: 'u1', p_reason: 'r', p_platform_funded: false }])
    await settleRefund(s, { outcome: 'processed', id: 'rf1', reference: 'ignored', amountKobo: 5 })
    expect(s.calls[1][1]).toEqual({ p_outcome: 'processed', p_refund_id: 'rf1', p_reference: null, p_provider_refund_id: null, p_transaction_reference: null, p_amount_kobo: 5, p_detail: null })
  })
  it('throw on an RPC error, never swallow it', async () => {
    await expect(requestRefund(fake({ request_refund: { error: { message: 'down' } } }), { cause: 'x', entityType: 'y', entityId: 'z' })).rejects.toThrow('down')
    await expect(settleRefund(fake({ settle_refund: { error: { message: 'down' } } }), { outcome: 'failed', id: 'a' })).rejects.toThrow('down')
  })
})

describe('executeCardRefund', () => {
  const run = (answerOrError, db = fake({ settle_refund: (a) => ({ result: a.p_outcome === 'processed' ? 'completed' : 'failed' }), mark_refund_processing: 'ok' })) => {
    const provider = { refundPayment: vi.fn(async () => { if (answerOrError instanceof Error) throw answerOrError; return answerOrError }) }
    return executeCardRefund(db, provider, refund, { logger: quiet }).then((r) => ({ r, db, provider }))
  }

  it('sends the payment\'s reference and the exact amount to the provider', async () => {
    const { provider } = await run({ providerRefundId: '9', status: 'processing', amountKobo: 1000000 })
    expect(provider.refundPayment).toHaveBeenCalledWith({ reference: 'chapp_1_abcdefgh', amountKobo: 1000000, reason: 'Refund' })
  })
  it('the provider says processed: settled as processed with ITS amount, state completed', async () => {
    const { r, db } = await run({ providerRefundId: '9', status: 'completed', amountKobo: 1000000 })
    expect(r.state).toBe('completed')
    expect(rpcs(db, 'settle_refund')[0]).toMatchObject({ p_outcome: 'processed', p_refund_id: 'rf1', p_provider_refund_id: '9', p_amount_kobo: 1000000 })
  })
  it('the provider accepted it (processing): linked by its refund id, NOT completed', async () => {
    const { r, db } = await run({ providerRefundId: '9', status: 'processing', amountKobo: 1000000 })
    expect(r.state).toBe('processing')
    expect(rpcs(db, 'mark_refund_processing')[0]).toEqual({ p_refund_id: 'rf1', p_provider_refund_id: '9', p_provider_status: 'processing' })
    expect(rpcs(db, 'settle_refund')).toHaveLength(0)
  })
  it('the provider says failed: settled as failed (the business is restored)', async () => {
    const { r, db } = await run({ providerRefundId: '9', status: 'failed' })
    expect(r.state).toBe('failed')
    expect(rpcs(db, 'settle_refund')[0].p_outcome).toBe('failed')
  })
  it('a definite refusal fails the refund; "already refunded" does NOT (it exists at the provider)', async () => {
    expect((await run(perr({ message: 'Amount exceeds the transaction amount' }))).r.state).toBe('failed')
    for (const message of ['Transaction has been fully reversed', 'This transaction was already refunded', 'Duplicate refund']) {
      const { r, db } = await run(perr({ message }))
      expect(r.state).toBe('processing')
      expect(rpcs(db, 'settle_refund')).toHaveLength(0)
    }
  })
  it('anything ambiguous, or on OUR side, is left pending - never failed on a guess', async () => {
    for (const e of [perr({ code: 'timeout', ambiguous: true, message: 'timed out' }), perr({ code: 'network', ambiguous: true }), perr({ code: 'auth', message: 'bad key' }),
                     perr({ code: 'config', message: 'no key' }), perr({ code: 'rate_limited', message: 'slow down' }), new Error('boom')]) {
      const { r, db } = await run(e)
      expect(r.state).toBe('pending')
      expect(rpcs(db, 'settle_refund')).toHaveLength(0)
    }
  })
  it('a completed answer the database does not accept (amount mismatch) is not reported as completed', async () => {
    const db = fake({ settle_refund: { result: 'amount_mismatch' } })
    expect((await run({ providerRefundId: '9', status: 'completed', amountKobo: 5 }, db)).r.state).toBe('pending')
  })
})

describe('settleRefundWebhook', () => {
  it('maps the four refund events; the provider amount is passed only for processed', async () => {
    const s = fake({ settle_refund: { result: 'completed', id: 'rf1' } })
    expect(await settleRefundWebhook(s, { event: 'refund.processed', data: { id: 77, transaction_reference: 'chapp_1_abcdefgh', amount: 1000000 } })).toMatchObject({ handled: true, outcome: 'processed' })
    expect(s.calls[0][1]).toMatchObject({ p_outcome: 'processed', p_provider_refund_id: '77', p_transaction_reference: 'chapp_1_abcdefgh', p_amount_kobo: 1000000 })
    await settleRefundWebhook(s, { event: 'refund.failed', data: { id: 77, transaction_reference: 'chapp_1_abcdefgh', amount: 1000000 } })
    expect(s.calls[1][1]).toMatchObject({ p_outcome: 'failed', p_amount_kobo: null })
    for (const e of ['refund.pending', 'refund.processing']) await settleRefundWebhook(s, { event: e, data: { transaction_reference: 'chapp_1_abcdefgh' } })
    expect(s.calls.slice(2).every(([, a]) => a.p_outcome === 'processing')).toBe(true)
  })
  it('ignores other events and events with nothing to identify a refund', async () => {
    expect(await settleRefundWebhook(fake(), { event: 'charge.success', data: { transaction_reference: 'x' } })).toEqual({ handled: false })
    expect(await settleRefundWebhook(fake(), { event: 'refund.processed', data: {} })).toEqual({ handled: false })
  })
  it('a refund nobody knows is acknowledged and changes nothing; contradictions are logged loudly', async () => {
    expect((await settleRefundWebhook(fake(), { event: 'refund.processed', data: { transaction_reference: 'zzz_zzz_zzz' } })).result.result).toBe('not_found')
    const logger = { error: vi.fn() }
    for (const result of ['conflict_processed_after_failed', 'conflict_failed_after_completed', 'amount_mismatch']) {
      await settleRefundWebhook(fake({ settle_refund: { result, id: 'rf1' } }), { event: 'refund.processed', data: { id: 1, transaction_reference: 'chapp_1_abcdefgh', amount: 1 } }, { logger })
    }
    expect(logger.error).toHaveBeenCalledTimes(3)
  })
  it('throws on a database error so the webhook is retried', async () => {
    await expect(settleRefundWebhook(fake({ settle_refund: { error: { message: 'down' } } }), { event: 'refund.failed', data: { id: 1 } })).rejects.toThrow('down')
  })
})

describe('sweepRefunds', () => {
  const row = (over = {}) => ({ id: 'rf1', reference: 'rf_a', status: 'requested', kind: 'card', amount_kobo: 100000, provider_transaction_reference: 'chapp_1_abcdefgh', created_at: old, ...over })
  const settleByOutcome = (a) => ({ result: a.p_outcome === 'processed' ? 'completed' : 'failed' })

  it('looks at the provider FIRST: a timed-out request that exists is NOT sent again', async () => {
    const provider = { verifyRefund: vi.fn(async () => ({ providerRefundId: '5', status: 'processing', amountKobo: 100000 })), refundPayment: vi.fn() }
    const s = fake({ mark_refund_processing: 'ok' }, { refunds: [row()] })
    expect(await sweepRefunds(s, provider, { now: NOW, logger: quiet })).toMatchObject({ checked: 1, processing: 1 })
    expect(provider.refundPayment).not.toHaveBeenCalled()
    expect(rpcs(s, 'mark_refund_processing')[0]).toMatchObject({ p_refund_id: 'rf1', p_provider_refund_id: '5' })
  })
  it('the provider has never heard of a requested refund: it is sent now', async () => {
    const provider = { verifyRefund: vi.fn(async () => { throw perr({ code: 'not_found' }) }), refundPayment: vi.fn(async () => ({ providerRefundId: '6', status: 'completed', amountKobo: 100000 })) }
    const s = fake({ settle_refund: settleByOutcome }, { refunds: [row()] })
    expect(await sweepRefunds(s, provider, { now: NOW, logger: quiet })).toMatchObject({ completed: 1 })
    expect(provider.refundPayment).toHaveBeenCalledTimes(1)
  })
  it('a processing refund the provider reports processed / failed is settled from that answer', async () => {
    const answers = [{ providerRefundId: '1', status: 'completed', amountKobo: 100000 }, { providerRefundId: '2', status: 'failed' }, { providerRefundId: '3', status: 'processing' }]
    let i = 0
    const provider = { verifyRefund: vi.fn(async () => answers[i++]), refundPayment: vi.fn() }
    const s = fake({ settle_refund: settleByOutcome }, { refunds: [row({ id: 'a', status: 'processing' }), row({ id: 'b', status: 'processing' }), row({ id: 'c', status: 'processing' })] })
    expect(await sweepRefunds(s, provider, { now: NOW, logger: quiet })).toEqual({ checked: 3, completed: 1, failed: 1, processing: 1, pending: 0, errors: 0 })
    expect(provider.refundPayment).not.toHaveBeenCalled()
  })
  it('a provider outage never fails or re-sends anything; a processing refund the provider does not know waits', async () => {
    const provider = { verifyRefund: vi.fn(async () => { throw perr({ code: 'timeout', ambiguous: true }) }), refundPayment: vi.fn() }
    const s = fake({}, { refunds: [row(), row({ id: 'p', status: 'processing' })] })
    expect(await sweepRefunds(s, provider, { now: NOW, logger: quiet })).toMatchObject({ pending: 2 })
    expect(provider.refundPayment).not.toHaveBeenCalled()
    expect(rpcs(s, 'settle_refund')).toHaveLength(0)
    const gone = { verifyRefund: vi.fn(async () => { throw perr({ code: 'not_found' }) }), refundPayment: vi.fn() }
    expect(await sweepRefunds(fake({}, { refunds: [row({ status: 'processing' })] }), gone, { now: NOW, logger: quiet })).toMatchObject({ pending: 1 })
    expect(gone.refundPayment).not.toHaveBeenCalled()
  })
  it('keeps going after a database error on one refund; a query failure throws', async () => {
    const provider = { verifyRefund: vi.fn(async () => ({ providerRefundId: '1', status: 'completed', amountKobo: 1 })), refundPayment: vi.fn() }
    let i = 0
    const s = fake({ settle_refund: () => (i++ === 0 ? { error: { message: 'blip' } } : { result: 'completed' }) }, { refunds: [row({ id: 'a' }), row({ id: 'b' })] })
    expect(await sweepRefunds(s, provider, { now: NOW, logger: quiet })).toMatchObject({ checked: 2, errors: 1, completed: 1 })
    await expect(sweepRefunds({ from: () => { const c = { select: () => c, in: () => c, lt: () => c, order: () => c, limit: async () => ({ data: null, error: { message: 'down' } }) }; return c } }, provider)).rejects.toThrow('down')
  })
  it('exports a 10 minute grace period', () => { expect(REFUND_GRACE_MS).toBe(600000) })
})

describe('refundUnappliedPayments', () => {
  it('requests and sends a refund for each unapplied payment; an existing refund is not repeated', async () => {
    const provider = { refundPayment: vi.fn(async () => ({ providerRefundId: '1', status: 'processing', amountKobo: 5 })) }
    const answers = [
      { outcome: 'requested', id: 'rf1', reference: 'rf_1', amount_kobo: 5, provider_transaction_reference: 'chapp_1_abcdefgh' },
      { outcome: 'already_requested', id: 'rf2' },
      { outcome: 'not_refundable', status: 'settled' },
    ]
    let i = 0
    const s = fake({ request_refund: () => answers[i++], mark_refund_processing: 'ok' }, { payment_intents: [{ id: 'i1', reference: 'r1' }, { id: 'i2', reference: 'r2' }, { id: 'i3', reference: 'r3' }] })
    expect(await refundUnappliedPayments(s, provider, { logger: quiet })).toEqual({ checked: 3, requested: 1, alreadyRequested: 1, completed: 0, processing: 1, failed: 0, pending: 0, errors: 0 })
    expect(provider.refundPayment).toHaveBeenCalledTimes(1)
    expect(rpcs(s, 'request_refund')[0]).toMatchObject({ p_cause: 'needs_refund_intent', p_entity_type: 'payment_intent', p_entity_id: 'i1' })
  })
  it('one failure does not stop the rest', async () => {
    const provider = { refundPayment: vi.fn() }
    let i = 0
    const s = fake({ request_refund: () => (i++ === 0 ? { error: { message: 'x' } } : { outcome: 'already_requested' }) }, { payment_intents: [{ id: 'a', reference: 'r' }, { id: 'b', reference: 'r' }] })
    expect(await refundUnappliedPayments(s, provider, { logger: quiet })).toMatchObject({ checked: 2, errors: 1, alreadyRequested: 1 })
  })
})

describe('onSettled: the seam that emails the payer after a refund flips to completed', () => {
  const row = (over = {}) => ({ id: 'rf1', reference: 'rf_a', status: 'requested', kind: 'card', amount_kobo: 100000, provider_transaction_reference: 'chapp_1_abcdefgh', created_at: old, ...over })

  it('executeCardRefund fires it exactly when the settle flips completed - not on already_completed, failed, or processing', async () => {
    const fired = []
    const onSettled = vi.fn((r) => { fired.push(r) })
    const provider = { refundPayment: vi.fn(async ({ ...o }) => ({ providerRefundId: '9', status: 'completed', amountKobo: 1000000 })) }

    await executeCardRefund(fake({ settle_refund: { result: 'completed' } }), provider, refund, { logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled.mock.calls[0][0]).toMatchObject({ result: 'completed' })

    await executeCardRefund(fake({ settle_refund: { result: 'already_completed' } }), provider, refund, { logger: quiet, onSettled })
    await executeCardRefund(fake({ settle_refund: { result: 'failed' } }), { refundPayment: async () => ({ providerRefundId: '9', status: 'failed' }) }, refund, { logger: quiet, onSettled })
    await executeCardRefund(fake(), { refundPayment: async () => ({ providerRefundId: '9', status: 'processing' }) }, refund, { logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('executeCardRefund: a throwing onSettled is logged and never fails the settle that already committed', async () => {
    const logger = { error: vi.fn(), warn() {} }
    const r = await executeCardRefund(fake({ settle_refund: { result: 'completed' } }),
      { refundPayment: async () => ({ providerRefundId: '9', status: 'completed', amountKobo: 1000000 }) },
      refund, { logger, onSettled: async () => { throw new Error('mailer down') } })
    expect(r.state).toBe('completed')
    expect(logger.error).toHaveBeenCalledWith('refund.on_settled_failed', expect.objectContaining({ message: 'mailer down' }))
  })

  it('settleRefundWebhook fires it only when refund.processed flips the row completed', async () => {
    const onSettled = vi.fn()
    const event = { event: 'refund.processed', data: { id: 77, transaction_reference: 'chapp_1_abcdefgh', amount: 1000000 } }
    await settleRefundWebhook(fake({ settle_refund: { result: 'completed' } }), event, { logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(1)
    await settleRefundWebhook(fake({ settle_refund: { result: 'already_completed' } }), event, { logger: quiet, onSettled })
    await settleRefundWebhook(fake({ settle_refund: { result: 'failed' } }), { event: 'refund.failed', data: { transaction_reference: 'chapp_1_abcdefgh' } }, { logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('sweepRefunds fires it for the direct settle AND for a re-send that completes in this pass; a provider still thinking does not fire', async () => {
    const onSettled = vi.fn()
    const direct = { verifyRefund: vi.fn(async () => ({ providerRefundId: '1', status: 'completed', amountKobo: 100000 })), refundPayment: vi.fn() }
    await sweepRefunds(fake({ settle_refund: { result: 'completed' } }, { refunds: [row()] }), direct, { now: NOW, logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(1)

    const resend = { verifyRefund: vi.fn(async () => { throw perr({ code: 'not_found' }) }), refundPayment: vi.fn(async () => ({ providerRefundId: '6', status: 'completed', amountKobo: 100000 })) }
    await sweepRefunds(fake({ settle_refund: { result: 'completed' } }, { refunds: [row()] }), resend, { now: NOW, logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(2)

    const thinking = { verifyRefund: vi.fn(async () => ({ providerRefundId: '1', status: 'processing', amountKobo: 100000 })), refundPayment: vi.fn() }
    await sweepRefunds(fake({ mark_refund_processing: 'ok' }, { refunds: [row()] }), thinking, { now: NOW, logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(2)
  })

  it('refundCancelledAppointments forwards it into the card refund; a refund that was already completed at request time does not re-fire', async () => {
    const onSettled = vi.fn()
    const provider = { refundPayment: vi.fn(async () => ({ providerRefundId: '1', status: 'completed', amountKobo: 5 })) }
    const answers = [
      { outcome: 'completed', id: 'r1' },
      { outcome: 'requested', id: 'r2', reference: 'rf_2', amount_kobo: 5, provider_transaction_reference: 'chapp_1_abcdefgh' },
    ]
    let i = 0
    const s = fake({ request_refund: () => answers[i++], mark_refund_processing: 'ok', settle_refund: { result: 'completed', id: 'r2' } }, { appointments: [{ id: 'a1' }, { id: 'a2' }] })
    await refundCancelledAppointments(s, provider, { logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled.mock.calls[0][0]).toMatchObject({ id: 'r2', result: 'completed' })
  })

  it('refundUnappliedPayments forwards it; runRefundSweeps passes it to every job', async () => {
    const onSettled = vi.fn()
    const provider = { verifyRefund: vi.fn(), refundPayment: vi.fn(async () => ({ providerRefundId: '1', status: 'completed', amountKobo: 5 })) }
    let i = 0
    const s = fake({
      request_refund: () => (i++ === 0 ? { outcome: 'requested', id: 'rf1', reference: 'rf_1', amount_kobo: 5, provider_transaction_reference: 'chapp_1_abcdefgh' } : { outcome: 'already_requested', id: 'rf2' }),
      mark_refund_processing: 'ok', settle_refund: { result: 'completed', id: 'rf1' },
    }, { payment_intents: [{ id: 'i1', reference: 'r1' }, { id: 'i2', reference: 'r2' }] })
    await runRefundSweeps(s, provider, { logger: quiet, onSettled })
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled.mock.calls[0][0]).toMatchObject({ id: 'rf1', result: 'completed' })
  })
})

describe('refundCancelledAppointments / runRefundSweeps', () => {
  it('refunds each cancelled-but-paid appointment once: CareCoin refunds complete in the database, card refunds go to the provider', async () => {
    const { refundCancelledAppointments } = await import('../refunds.js')
    const provider = { refundPayment: vi.fn(async () => ({ providerRefundId: '1', status: 'processing', amountKobo: 5 })) }
    const answers = [
      { outcome: 'completed', id: 'r1' },
      { outcome: 'requested', id: 'r2', reference: 'rf_2', amount_kobo: 5, provider_transaction_reference: 'chapp_1_abcdefgh' },
      { outcome: 'already_requested', id: 'r3' },
      { outcome: 'not_refundable_by_platform' },
    ]
    let i = 0
    const s = fake({ request_refund: () => answers[i++], mark_refund_processing: 'ok' }, { appointments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }] })
    expect(await refundCancelledAppointments(s, provider, { logger: quiet })).toEqual({ checked: 4, requested: 2, alreadyRequested: 1, completed: 1, processing: 1, failed: 0, pending: 0, errors: 0 })
    expect(provider.refundPayment).toHaveBeenCalledTimes(1)
    expect(rpcs(s, 'request_refund')[0]).toMatchObject({ p_cause: 'booking_cancelled', p_entity_type: 'appointment', p_entity_id: 'a1' })
  })
  it('runRefundSweeps runs all three jobs and one failing does not stop the others', async () => {
    const { runRefundSweeps } = await import('../refunds.js')
    const provider = { verifyRefund: vi.fn(), refundPayment: vi.fn() }
    const s = { rpc: async () => ({ data: null, error: null }), from: (t) => { const c = { select: () => c, in: () => c, eq: () => c, lt: () => c, order: () => c, limit: async () => (t === 'refunds' ? { data: null, error: { message: 'down' } } : { data: [], error: null }) }; return c } }
    const out = await runRefundSweeps(s, provider, { logger: quiet })
    expect(out.sweep).toEqual({ error: 'down' })
    expect(out.unapplied).toMatchObject({ checked: 0 })
    expect(out.cancelled).toMatchObject({ checked: 0 })
  })
})
