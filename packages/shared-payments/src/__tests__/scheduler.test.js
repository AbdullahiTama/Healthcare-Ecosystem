import { describe, it, expect, vi } from 'vitest'
import { ProviderError } from '../errors.js'
import { createBudget, createLoopGuard, runScheduled, isProviderInfraError } from '../scheduler.js'
import { sweepOpenIntents } from '../reconciliation.js'
import { sweepRefunds } from '../refunds.js'
import { sweepWithdrawals } from '../withdrawals.js'
import { createFakeSupabase } from '../testing.js'

const perr = (code, over = {}) => new ProviderError({ code, message: code, operation: 'op', ...over })

describe('isProviderInfraError', () => {
  it.each(['timeout', 'network', 'provider_unavailable', 'rate_limited', 'auth', 'config'])('%s means the provider is not usable right now', (code) => {
    expect(isProviderInfraError(perr(code))).toBe(true)
  })
  it.each(['not_found', 'provider_rejected', 'invalid_request', 'duplicate_reference', 'invalid_response'])('%s is an answer about one transaction, not an outage', (code) => {
    expect(isProviderInfraError(perr(code))).toBe(false)
  })
  it('an ordinary error is not a provider outage', () => { expect(isProviderInfraError(new Error('x'))).toBe(false) })
})

describe('createBudget', () => {
  it('counts down against an injected clock', () => {
    let t = 1000
    const b = createBudget(5000, { now: () => t })
    expect(b.deadline).toBe(6000)
    expect(b.remainingMs()).toBe(5000)
    t = 4000
    expect(b.remainingMs()).toBe(2000)
    expect(b.expired()).toBe(false)
    t = 7000
    expect(b.remainingMs()).toBe(0)
    expect(b.expired()).toBe(true)
  })
})

describe('createLoopGuard', () => {
  it('stops at the deadline', () => {
    let t = 0
    const g = createLoopGuard({ deadline: 100, now: () => t })
    expect(g.stop()).toBe(false)
    t = 100
    expect(g.stop()).toBe(true)
    expect(g.reason).toBe('deadline')
  })
  it('stops after three consecutive provider outages, and a success in between resets the count', () => {
    const g = createLoopGuard({})
    g.failure(perr('timeout')); g.failure(perr('network'))
    expect(g.stop()).toBe(false)
    g.success()
    g.failure(perr('provider_unavailable')); g.failure(perr('timeout'))
    expect(g.stop()).toBe(false)
    g.failure(perr('rate_limited'))
    expect(g.stop()).toBe(true)
    expect(g.reason).toBe('provider_unavailable')
  })
  it('an answer about one transaction (not_found, rejected) or a non-provider error never opens it', () => {
    const g = createLoopGuard({})
    for (let i = 0; i < 10; i++) { g.failure(perr('not_found')); g.failure(perr('provider_rejected')); g.failure(new Error('db')) }
    expect(g.stop()).toBe(false)
  })
  it('stays stopped once stopped', () => {
    const g = createLoopGuard({ deadline: 10, now: () => 20 })
    expect(g.stop()).toBe(true)
    g.success()
    expect(g.stop()).toBe(true)
  })
})

describe('runScheduled', () => {
  const gate = (answers) => createFakeSupabase({ rpc: { claim_job_slot: ({ p_job }) => (typeof answers === 'function' ? answers(p_job) : answers[p_job]) } })

  it('runs only the steps whose slot it wins, each with its own interval', async () => {
    const s = gate({ job_a: true, job_b: false })
    const a = vi.fn(async () => 'A'); const b = vi.fn(async () => 'B')
    const { report, failed } = await runScheduled(s, [{ name: 'a', everyMinutes: 5, run: a }, { name: 'b', everyMinutes: 30, run: b }])
    expect(report).toEqual({ a: 'A', b: { skipped: 'not_due' } })
    expect(failed).toEqual([])
    expect(b).not.toHaveBeenCalled()
    expect(s.calls.filter((c) => c.name === 'claim_job_slot').map((c) => [c.args.p_job, c.args.p_min_minutes])).toEqual([['job_a', 5], ['job_b', 30]])
  })

  it('force runs every step without asking the gate', async () => {
    const s = gate({})
    const run = vi.fn(async () => 1)
    await runScheduled(s, [{ name: 'a', everyMinutes: 5, run }], { force: true })
    expect(run).toHaveBeenCalled()
    expect(s.calls.some((c) => c.name === 'claim_job_slot')).toBe(false)
  })

  it('a step that fails is reported, the others still run', async () => {
    const s = gate(() => true)
    const logger = { error: vi.fn(), warn: vi.fn() }
    const { report, failed } = await runScheduled(s, [
      { name: 'a', everyMinutes: 1, run: async () => { throw new Error('boom') } },
      { name: 'b', everyMinutes: 1, run: async () => 'ok' },
    ], { logger })
    expect(report).toEqual({ a: { error: 'boom' }, b: 'ok' })
    expect(failed).toEqual(['a'])
    expect(logger.error).toHaveBeenCalledWith('scheduler.step_failed', { step: 'a', message: 'boom' })
  })

  it('a step that no longer fits in the budget is skipped (and costs no gate claim), and the deadline is handed to the steps that do run', async () => {
    let t = 0
    const budget = createBudget(10_000, { now: () => t })
    const s = gate(() => true)
    const seen = []
    const { report } = await runScheduled(s, [
      { name: 'slow', everyMinutes: 1, run: async ({ deadline }) => { seen.push(deadline); t = 9_000; return 'done' } },
      { name: 'late', everyMinutes: 1, run: async () => 'never' },
    ], { budget })
    expect(seen).toEqual([10_000])
    expect(report).toEqual({ slow: 'done', late: { skipped: 'out_of_time' } })
    expect(s.calls.filter((c) => c.name === 'claim_job_slot').map((c) => c.args.p_job)).toEqual(['job_slow'])
  })

  it('a broken gate runs the step instead of silently stopping the money work', async () => {
    const s = createFakeSupabase({ rpc: { claim_job_slot: () => ({ data: null, error: { message: 'down' } }) } })
    const logger = { warn: vi.fn(), error: vi.fn() }
    const run = vi.fn(async () => 'ran')
    const { report } = await runScheduled(s, [{ name: 'a', everyMinutes: 1, run }], { logger })
    expect(report.a).toBe('ran')
    expect(logger.warn).toHaveBeenCalledWith('scheduler.gate_failed', { step: 'a', message: 'down' })
  })
})

describe('the sweeps stop for a deadline or a provider outage', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, reference: `ref_0000000${i}`, status: 'pending', purpose: 'shop_order', expected_amount: 1000, expires_at: new Date(Date.now() + 3600_000).toISOString() }))

  it('sweepOpenIntents stops after three consecutive provider outages and says so (the rest are due again after their backoff)', async () => {
    const list = rows(10)
    const s = createFakeSupabase({ tables: { payment_intents: list }, rpc: { list_open_intents_to_check: () => list, mark_intents_checked: () => 10 } })
    const verify = vi.fn(async () => { throw perr('timeout', { ambiguous: true }) })
    const r = await sweepOpenIntents(s, { name: 'paystack', verifyPayment: verify }, {})
    expect(verify).toHaveBeenCalledTimes(3)
    expect(r).toMatchObject({ checked: 10, errors: 3, stopped: 'provider_unavailable' })
  })

  it('sweepOpenIntents does not stop for answers about single payments', async () => {
    const list = rows(5)
    const s = createFakeSupabase({ tables: { payment_intents: list }, rpc: { list_open_intents_to_check: () => list, mark_intents_checked: () => 5 } })
    const verify = vi.fn(async () => ({ status: 'pending' }))
    const r = await sweepOpenIntents(s, { name: 'paystack', verifyPayment: verify }, {})
    expect(verify).toHaveBeenCalledTimes(5)
    expect(r.stopped).toBeUndefined()
  })

  it('sweepOpenIntents stops at the deadline', async () => {
    const list = rows(5)
    const s = createFakeSupabase({ tables: { payment_intents: list }, rpc: { list_open_intents_to_check: () => list, mark_intents_checked: () => 5 } })
    const verify = vi.fn(async () => ({ status: 'pending' }))
    const r = await sweepOpenIntents(s, { name: 'paystack', verifyPayment: verify }, { deadline: Date.now() - 1 })
    expect(verify).not.toHaveBeenCalled()
    expect(r.stopped).toBe('deadline')
  })

  const refundRows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, reference: `rf_${i}`, status: 'processing', kind: 'card', amount_kobo: 1000, provider_transaction_reference: `pay_0000000${i}`, created_at: '2020-01-01T00:00:00Z' }))
  const tableClient = (table, data) => ({
    from: () => { const chain = { select: () => chain, in: () => chain, eq: () => chain, lt: () => chain, not: () => chain, order: () => chain, limit: async () => ({ data, error: null }) }; return chain },
    rpc: async () => ({ data: { result: 'not_found' }, error: null }),
  })

  it('sweepRefunds stops after three consecutive provider outages, and at a deadline', async () => {
    const verifyRefund = vi.fn(async () => { throw perr('provider_unavailable') })
    const r = await sweepRefunds(tableClient('refunds', refundRows(8)), { verifyRefund }, { logger: { error() {} } })
    expect(verifyRefund).toHaveBeenCalledTimes(3)
    expect(r).toMatchObject({ pending: 3, stopped: 'provider_unavailable' })
    const verify2 = vi.fn()
    const r2 = await sweepRefunds(tableClient('refunds', refundRows(3)), { verifyRefund: verify2 }, { deadline: Date.now() - 1, logger: { error() {} } })
    expect(verify2).not.toHaveBeenCalled()
    expect(r2.stopped).toBe('deadline')
  })

  it('sweepWithdrawals stops at a deadline', async () => {
    const wd = Array.from({ length: 3 }, (_, i) => ({ id: `w${i}`, status: 'reserved', paystack_reference: `cf_wd_ref${i}`, created_at: '2020-01-01T00:00:00Z' }))
    const getStatus = vi.fn()
    const r = await sweepWithdrawals(tableClient('withdrawal_requests', wd), 'carefind', { getStatus, deadline: Date.now() - 1, logger: { error() {}, warn() {} } })
    expect(getStatus).not.toHaveBeenCalled()
    expect(r.stopped).toBe('deadline')
  })
})
