// The cron endpoint's financial work: named steps with intervals, one shared deadline, one failing step never blocks the others.
const h = vi.hoisted(() => ({ sweepWithdrawals: vi.fn(), runRefundSweeps: vi.fn(), runFinanceReconciliation: vi.fn(), provider: { name: 'paystack' } }))
vi.mock('../withdrawalRecovery.js', () => ({ sweepWithdrawals: h.sweepWithdrawals }))
vi.mock('../payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../financeReconcile.js', () => ({ runFinanceReconciliation: h.runFinanceReconciliation }))
vi.mock('@care-ecosystem/shared-payments', async (importOriginal) => ({ ...(await importOriginal()), runRefundSweeps: h.runRefundSweeps }))

import { createBudget } from '@care-ecosystem/shared-payments'
import { runFinanceJobs, FINANCE_STEPS_EVERY_MINUTES } from '../financeJobs.js'

const client = ({ due = () => true, release = { data: { released: 2, released_kobo: 100, partial: 0 }, error: null } } = {}) => {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args])
      if (name === 'claim_job_slot') return { data: due(args.p_job), error: null }
      if (name === 'release_shop_vendor_credits') return release
      return { data: null, error: { message: `unexpected rpc ${name}` } }
    },
  }
}

beforeEach(() => {
  h.sweepWithdrawals.mockReset().mockResolvedValue({ checked: 0 })
  h.runRefundSweeps.mockReset().mockResolvedValue({ sweep: { checked: 0 } })
  h.runFinanceReconciliation.mockReset().mockResolvedValue({ failed: [] })
})

describe('runFinanceJobs', () => {
  it('runs vendor release, withdrawals, refunds and reconciliation, each behind its own slot and interval', async () => {
    const s = client()
    const { report, failed } = await runFinanceJobs(s, { budget: createBudget(50_000) })
    expect(failed).toEqual([])
    expect(Object.keys(report)).toEqual(['vendor_release', 'withdrawals', 'refunds', 'reconciliation'])
    expect(report.vendor_release).toEqual({ released: 2, released_kobo: 100, partial: 0 })
    const asked = Object.fromEntries(s.calls.filter(([n]) => n === 'claim_job_slot').map(([, a]) => [a.p_job, a.p_min_minutes]))
    expect(asked).toEqual({
      job_vendor_release: FINANCE_STEPS_EVERY_MINUTES.vendor_release, job_withdrawals: FINANCE_STEPS_EVERY_MINUTES.withdrawals,
      job_refunds: FINANCE_STEPS_EVERY_MINUTES.refunds, job_reconciliation: FINANCE_STEPS_EVERY_MINUTES.reconciliation,
    })
    expect(FINANCE_STEPS_EVERY_MINUTES.reconciliation).toBe(1)           // its own sub-steps are gated inside (replay 5, provider 30, ...)
  })

  it('a step that is not due is not run (the endpoint is hit every minute; the sweeps are due every five)', async () => {
    const s = client({ due: (job) => job === 'job_reconciliation' })
    const { report } = await runFinanceJobs(s, { budget: createBudget(50_000) })
    expect(report.withdrawals).toEqual({ skipped: 'not_due' })
    expect(report.refunds).toEqual({ skipped: 'not_due' })
    expect(report.vendor_release).toEqual({ skipped: 'not_due' })
    expect(h.sweepWithdrawals).not.toHaveBeenCalled()
    expect(h.runRefundSweeps).not.toHaveBeenCalled()
    expect(h.runFinanceReconciliation).toHaveBeenCalledTimes(1)
  })

  it('hands the shared deadline to every sweep', async () => {
    const budget = createBudget(50_000)
    await runFinanceJobs(client(), { budget })
    expect(h.sweepWithdrawals).toHaveBeenCalledWith(expect.anything(), { deadline: budget.deadline })
    expect(h.runRefundSweeps.mock.calls[0][2]).toMatchObject({ deadline: budget.deadline })
    expect(h.runFinanceReconciliation).toHaveBeenCalledWith(expect.anything(), { deadline: budget.deadline })
  })

  it('a failing step is reported and the others still run', async () => {
    h.sweepWithdrawals.mockRejectedValue(new Error('paystack down'))
    const { report, failed } = await runFinanceJobs(client(), { budget: createBudget(50_000) })
    expect(failed).toEqual(['withdrawals'])
    expect(report.withdrawals).toEqual({ error: 'paystack down' })
    expect(h.runRefundSweeps).toHaveBeenCalled()
    expect(h.runFinanceReconciliation).toHaveBeenCalled()
  })

  it('a database error from the vendor release is a failed step, not an exception', async () => {
    const { report, failed } = await runFinanceJobs(client({ release: { data: null, error: { message: 'relation missing' } } }), { budget: createBudget(50_000) })
    expect(failed).toEqual(['vendor_release'])
    expect(report.vendor_release).toEqual({ error: 'relation missing' })
  })

  it('with the budget spent, nothing starts', async () => {
    let t = 0
    const budget = createBudget(1000, { now: () => t })
    t = 5000
    const { report } = await runFinanceJobs(client(), { budget })
    for (const name of ['vendor_release', 'withdrawals', 'refunds', 'reconciliation']) expect(report[name]).toEqual({ skipped: 'out_of_time' })
    expect(h.sweepWithdrawals).not.toHaveBeenCalled()
  })

  it('"run now" skips the slots', async () => {
    const s = client({ due: () => false })
    await runFinanceJobs(s, { budget: createBudget(50_000), force: true })
    expect(s.calls.some(([n]) => n === 'claim_job_slot')).toBe(false)
    expect(h.sweepWithdrawals).toHaveBeenCalled()
  })
})
