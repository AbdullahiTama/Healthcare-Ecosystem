import { describe, it, expect, vi } from 'vitest'
import { ProviderError } from '../errors.js'
import { createFakeSupabase } from '../testing.js'
import { replayProviderEvents, sweepOpenIntents, reconcileProviderTransactions, runReconciliation, runDbReconciliation } from '../reconciliation.js'

const FUTURE = new Date(Date.now() + 3600_000).toISOString()
const PAST = new Date(Date.now() - 3600_000).toISOString()
const intent = (over = {}) => ({ id: 'i1', reference: 'ref_00000001', status: 'pending', purpose: 'shop_order', expected_amount: 100000, provider_transaction_id: null, expires_at: FUTURE, ...over })
const tx = (over = {}) => ({ provider: 'paystack', reference: 'ref_00000001', providerTransactionId: '77', status: 'success', amountKobo: 100000, currency: 'NGN', paidAt: '2026-10-05T10:00:00Z', channel: 'card', ...over })
const provider = (over = {}) => ({ name: 'paystack', verifyPayment: vi.fn(), listTransactions: vi.fn(), ...over })
const ok = (v) => ({ data: v, error: null })
const syncCall = (s) => s.calls.find((c) => c.name === 'sync_reconciliation_findings')?.args

describe('replayProviderEvents', () => {
  const events = [{ id: 'e1', event_id: 'charge.success:1', payload: { event: 'charge.success' }, attempts: 1 }, { id: 'e2', event_id: 'transfer.success:2', payload: { event: 'transfer.success' }, attempts: 0 }]
  const make = () => createFakeSupabase({ tables: { payment_provider_events: events }, rpc: { list_replayable_provider_events: () => events } })

  it('processes each stored payload again and stamps the outcome; a failure is recorded with its attempt and does not stop the rest', async () => {
    const s = make()
    const process = vi.fn(async (p) => { if (p.event === 'charge.success') throw new Error('db down'); return 'processed' })
    const r = await replayProviderEvents(s, { process })
    expect(r).toEqual({ checked: 2, processed: 1, ignored: 0, failed: 1 })
    expect(process).toHaveBeenCalledTimes(2)
    expect(s.data.payment_provider_events.find((e) => e.id === 'e1')).toMatchObject({ outcome: 'failed', attempts: 2, last_error: 'db down' })
    expect(s.data.payment_provider_events.find((e) => e.id === 'e2')).toMatchObject({ outcome: 'processed', attempts: 1 })
    expect(s.data.payment_provider_events.find((e) => e.id === 'e2').processed_at).toBeTruthy()
    expect(s.data.payment_provider_events.find((e) => e.id === 'e1').processed_at).toBeUndefined()   // a failed attempt is never stamped processed
  })

  it('counts ignored events separately and needs a process function', async () => {
    const s = make()
    expect(await replayProviderEvents(s, { process: async () => 'ignored' })).toMatchObject({ ignored: 2, processed: 0 })
    await expect(replayProviderEvents(s, {})).rejects.toThrow(/process function/)
  })

  it('passes its limits to the database and surfaces a database error', async () => {
    const s = createFakeSupabase({ rpc: { list_replayable_provider_events: () => ({ data: null, error: { message: 'boom' } }) } })
    await expect(replayProviderEvents(s, { process: async () => 'processed' })).rejects.toThrow(/list_replayable_provider_events: boom/)
    const s2 = make()
    await replayProviderEvents(s2, { process: async () => 'processed', olderThanMinutes: 5, maxAttempts: 3, limit: 7 })
    expect(s2.calls.find((c) => c.name === 'list_replayable_provider_events').args).toEqual({ p_older_than_minutes: 5, p_max_attempts: 3, p_limit: 7 })
  })
})

describe('sweepOpenIntents', () => {
  const sweep = async ({ rows, verify, settle, tables, onSettled } = {}) => {
    const s = createFakeSupabase({ tables: { payment_intents: tables || rows }, rpc: { list_open_intents_to_check: () => rows, settle_payment_intent: settle || (() => ({ outcome: 'settled', purpose: 'shop_order' })) } })
    const p = provider({ verifyPayment: vi.fn(verify || (async () => ({ status: 'success', providerTransactionId: '9', amountKobo: 100000, currency: 'NGN' }))) })
    return { s, p, summary: await sweepOpenIntents(s, p, { onSettled }) }
  }

  it('asks the provider, settles through the engine and runs the effects exactly for what this sweep settled', async () => {
    const onSettled = vi.fn()
    const { summary, s } = await sweep({ rows: [intent()], onSettled })
    expect(summary).toMatchObject({ checked: 1, settled: 1, errors: 0 })
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(s.calls.find((c) => c.name === 'settle_payment_intent').args).toMatchObject({ p_reference: 'ref_00000001', p_amount_kobo: 100000 })
  })

  it('an already-settled or needs_refund answer does no effects', async () => {
    const onSettled = vi.fn()
    expect((await sweep({ rows: [intent()], settle: () => ({ outcome: 'already_settled' }), onSettled })).summary.settled).toBe(0)
    expect((await sweep({ rows: [intent()], settle: () => ({ outcome: 'needs_refund', reason: 'amount_changed' }), onSettled })).summary.needsRefund).toBe(1)
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('an attempt the provider says was abandoned and that is past its expiry is closed; one still inside its window is left alone', async () => {
    const abandoned = async () => ({ status: 'abandoned' })
    const past = await sweep({ rows: [intent({ expires_at: PAST })], verify: abandoned })
    expect(past.summary).toMatchObject({ notPaid: 1, expired: 1 })
    expect(past.s.data.payment_intents[0].status).toBe('failed')     // settleByReference already closed a provider-final failure
    const fresh = await sweep({ rows: [intent({ expires_at: FUTURE })], verify: async () => ({ status: 'pending' }) })
    expect(fresh.summary).toMatchObject({ notPaid: 1, expired: 0 })
    expect(fresh.s.data.payment_intents[0].status).toBe('pending')
  })

  it('a reference the provider has never heard of is expired once past its window, and kept while it could still be paid', async () => {
    const notFound = async () => { throw new ProviderError({ code: 'provider_rejected', message: 'Transaction reference not found', operation: 'verifyPayment' }) }
    const past = await sweep({ rows: [intent({ expires_at: PAST })], verify: notFound })
    expect(past.summary).toMatchObject({ expired: 1, errors: 0 })
    expect(past.s.data.payment_intents[0].status).toBe('expired')
    const fresh = await sweep({ rows: [intent({ expires_at: FUTURE })], verify: notFound })
    expect(fresh.summary).toMatchObject({ expired: 0, errors: 1 })
  })

  it('an ambiguous provider error (timeout) is an error to retry next time, never a reason to close', async () => {
    const timeout = async () => { throw new ProviderError({ code: 'timeout', message: 'timed out', operation: 'verifyPayment', ambiguous: true }) }
    const r = await sweep({ rows: [intent({ expires_at: PAST })], verify: timeout })
    expect(r.summary).toMatchObject({ errors: 1, expired: 0 })
    expect(r.s.data.payment_intents[0].status).toBe('pending')
  })

  it('one failing intent does not stop the others', async () => {
    const rows = [intent({ reference: 'ref_00000001' }), intent({ id: 'i2', reference: 'ref_00000002' })]
    const verify = vi.fn(async ({ reference }) => { if (reference === 'ref_00000001') throw new Error('network'); return { status: 'success', providerTransactionId: '9', amountKobo: 100000, currency: 'NGN' } })
    const { summary } = await sweep({ rows, verify })
    expect(summary).toMatchObject({ checked: 2, settled: 1, errors: 1 })
  })
})

describe('reconcileProviderTransactions', () => {
  const window = { from: '2026-10-04T00:00:00Z', to: '2026-10-05T00:00:00Z' }
  const run = async ({ pages, intents = [], settle, onSettled, verify } = {}) => {
    const s = createFakeSupabase({ tables: { payment_intents: intents }, rpc: { sync_reconciliation_findings: () => ({ open: 0 }), settle_payment_intent: settle || (() => ({ outcome: 'settled', purpose: 'shop_order' })) } })
    const list = vi.fn(async ({ page }) => pages[page - 1])
    const p = provider({ listTransactions: list, verifyPayment: vi.fn(verify || (async () => ({ status: 'success', providerTransactionId: '77', amountKobo: 100000, currency: 'NGN' }))) })
    const summary = await reconcileProviderTransactions(s, p, { ...window, onSettled })
    return { s, p, summary, list, args: syncCall(s) }
  }
  const page = (transactions, hasMore = false, skipped = 0) => ({ transactions, hasMore, skipped })

  it('a charge no intent recognises is a critical finding (and nothing is settled from it)', async () => {
    const { args, s, summary } = await run({ pages: [page([tx({ reference: 'stranger_0001' })])] })
    expect(args.p_source).toBe('provider')
    expect(args.p_current).toEqual([expect.objectContaining({ kind: 'charge_without_intent', subject_id: 'stranger_0001', severity: 'critical' })])
    expect(args.p_scope).toEqual(['stranger_0001'])
    expect(s.calls.some((c) => c.name === 'settle_payment_intent')).toBe(false)
    expect(summary).toMatchObject({ scanned: 1, findings: 1, recovered: 0 })
  })

  it('an amount that differs from the intent is a finding and is never settled', async () => {
    const { args, s } = await run({ pages: [page([tx({ amountKobo: 90000 })])], intents: [intent()] })
    expect(args.p_current[0]).toMatchObject({ kind: 'amount_mismatch', severity: 'critical' })
    expect(s.calls.some((c) => c.name === 'settle_payment_intent')).toBe(false)
  })

  it('a different provider transaction id than the intent is bound to is a finding', async () => {
    const { args } = await run({ pages: [page([tx({ providerTransactionId: '99' })])], intents: [intent({ status: 'settled', provider_transaction_id: '77' })] })
    expect(args.p_current[0]).toMatchObject({ kind: 'transaction_id_mismatch' })
  })

  it('a settled intent that matches is clean; the sync still runs so old findings resolve', async () => {
    const { args, summary } = await run({ pages: [page([tx()])], intents: [intent({ status: 'settled', provider_transaction_id: '77' })] })
    expect(args.p_current).toEqual([])
    expect(args.p_scope).toEqual(['ref_00000001'])
    expect(summary.findings).toBe(0)
  })

  it('paid at the provider but open here: it is settled right now and runs the effects, and is not a finding', async () => {
    const onSettled = vi.fn()
    const { args, summary } = await run({ pages: [page([tx()])], intents: [intent()], onSettled })
    expect(args.p_current).toEqual([])
    expect(summary.recovered).toBe(1)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('paid at the provider, still open after the settlement attempt (engine refused or errored) stays a critical finding', async () => {
    const refused = await run({ pages: [page([tx()])], intents: [intent()], settle: () => ({ outcome: 'rejected', reason: 'transaction_id_conflict' }) })
    expect(refused.args.p_current[0]).toMatchObject({ kind: 'paid_not_settled' })
    expect(refused.args.p_current[0].detail).toMatch(/rejected \(transaction_id_conflict\)/)
    const errored = await run({ pages: [page([tx()])], intents: [intent()], verify: async () => { throw new Error('provider down') } })
    expect(errored.args.p_current[0]).toMatchObject({ kind: 'paid_not_settled' })
    expect(errored.args.p_current[0].detail).toMatch(/settlement failed: provider down/)
  })

  it('reads every page, and reports rows it could not compare', async () => {
    const { list, summary, args } = await run({ pages: [page([tx({ reference: 'a_000000001' })], true, 1), page([tx({ reference: 'b_000000001' })], false, 2)] })
    expect(list).toHaveBeenCalledTimes(2)
    expect(summary).toMatchObject({ scanned: 2, skipped: 3, pages: 2 })
    expect(args.p_scope.sort()).toEqual(['a_000000001', 'b_000000001'])
  })

  it('a provider failure while listing writes nothing (no finding is resolved on a guess)', async () => {
    const s = createFakeSupabase({ rpc: { sync_reconciliation_findings: () => ({}) } })
    const p = provider({ listTransactions: async () => { throw new Error('rate limited') } })
    await expect(reconcileProviderTransactions(s, p, window)).rejects.toThrow(/rate limited/)
    expect(syncCall(s)).toBeUndefined()
  })
})

describe('runReconciliation', () => {
  const base = (over = {}) => ({
    sync_reconciliation_findings: () => ({}), list_open_intents_to_check: () => [], list_replayable_provider_events: () => [],
    run_db_reconciliation: () => ({ run_id: 'r', totals: { open_critical: 0, open_warning: 0, open_info: 1 } }), ...over,
  })

  it('runs replay, sweep, provider comparison and the database checks, in that order', async () => {
    const s = createFakeSupabase({ rpc: base() })
    const p = provider({ listTransactions: async () => ({ transactions: [], hasMore: false, skipped: 0 }) })
    const r = await runReconciliation(s, p, { processEvent: async () => 'processed' })
    expect(r.failed).toEqual([])
    expect(r.replay).toMatchObject({ checked: 0 }); expect(r.sweep).toMatchObject({ checked: 0 }); expect(r.provider).toMatchObject({ scanned: 0 }); expect(r.db.totals.open_info).toBe(1)
    expect(s.calls.filter((c) => c.op === 'rpc').map((c) => c.name)).toEqual(['list_replayable_provider_events', 'list_open_intents_to_check', 'sync_reconciliation_findings', 'run_db_reconciliation'])
  })

  it('a failing step is reported and does not stop the others; open critical findings are logged loudly', async () => {
    const s = createFakeSupabase({ rpc: base({ list_open_intents_to_check: () => ({ data: null, error: { message: 'db' } }), run_db_reconciliation: () => ({ run_id: 'r', totals: { open_critical: 2, open_warning: 0, open_info: 0 } }) }) })
    const p = provider({ listTransactions: async () => { throw new Error('paystack down') } })
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const r = await runReconciliation(s, p, { processEvent: async () => 'processed', logger })
    expect(r.failed).toEqual(['sweep', 'provider'])
    expect(r.db.totals.open_critical).toBe(2)
    expect(logger.error).toHaveBeenCalledWith('reconciliation.open_findings', { open_critical: 2, open_warning: 0, open_info: 0 })
  })

  it('without a processEvent the replay is skipped (CareHub has no webhook of its own)', async () => {
    const s = createFakeSupabase({ rpc: base() })
    const r = await runReconciliation(s, provider({ listTransactions: async () => ({ transactions: [], hasMore: false }) }))
    expect(r.replay).toBeNull()
  })

  it('looks back over the configured window', async () => {
    const s = createFakeSupabase({ rpc: base() })
    const list = vi.fn(async () => ({ transactions: [], hasMore: false }))
    const now = new Date('2026-10-05T12:00:00Z')
    await runReconciliation(s, provider({ listTransactions: list }), { now: () => now, lookbackHours: 24 })
    expect(list.mock.calls[0][0]).toMatchObject({ from: '2026-10-04T12:00:00.000Z', to: '2026-10-05T12:00:00.000Z' })
  })

  it('runDbReconciliation surfaces a database error', async () => {
    await expect(runDbReconciliation(createFakeSupabase({ rpc: { run_db_reconciliation: () => ({ data: null, error: { message: 'x' } }) } }))).rejects.toThrow(/run_db_reconciliation: x/)
  })
})
