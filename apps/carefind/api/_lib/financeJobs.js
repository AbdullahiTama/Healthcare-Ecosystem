import { runRefundSweeps, runScheduled } from '@care-ecosystem/shared-payments'
import { sweepWithdrawals } from './withdrawalRecovery.js'
import { getPaystackProvider, paymentLogger } from './payments.js'
import { runFinanceReconciliation } from './financeReconcile.js'

// The financial work the cron endpoint does after the email outbox, as named steps with intervals (see packages/shared-payments
// scheduler.js). The endpoint is driven EVERY MINUTE by Supabase Cron, and a function has a hard time limit, so:
//   * each step runs only when its slot is due (an atomic database gate shared by every instance and by CareHub's endpoint, so the
//     same step is never run twice at once and a second deployment is a redundancy, not duplicate work);
//   * the whole invocation shares one deadline: a step that no longer fits is skipped (`out_of_time`) and runs next minute, and the
//     loops inside the steps stop at the deadline;
//   * a failing step is reported and never blocks the others.
// Every step is idempotent, so being stopped half way, or running in two places, is safe.
export const FINANCE_STEPS_EVERY_MINUTES = Object.freeze({ vendor_release: 5, withdrawals: 5, refunds: 5, reconciliation: 1 })

export async function runFinanceJobs(supabase, { budget, force = false } = {}) {
  const provider = getPaystackProvider()
  const steps = [
    {
      // held -> available for shop orders delivered more than the return window ago (database only, no provider)
      name: 'vendor_release', everyMinutes: FINANCE_STEPS_EVERY_MINUTES.vendor_release,
      run: async () => {
        const { data, error } = await supabase.rpc('release_shop_vendor_credits', { p_limit: 200 })
        if (error) throw new Error(error.message)
        if (data?.partial > 0) paymentLogger.warn('shop.vendor_release_partial', { partial: data.partial })
        return data
      },
    },
    // CareFind withdrawals still reserved/processing after the grace period: ask Paystack, settle or refund
    { name: 'withdrawals', everyMinutes: FINANCE_STEPS_EVERY_MINUTES.withdrawals, run: ({ deadline }) => sweepWithdrawals(supabase, { deadline }) },
    // card refunds the provider has not answered, payments that could not be applied, appointments cancelled while paid
    { name: 'refunds', everyMinutes: FINANCE_STEPS_EVERY_MINUTES.refunds, run: ({ deadline }) => runRefundSweeps(supabase, provider, { logger: paymentLogger, deadline }) },
    // replay failed webhooks, settle payments Paystack says were paid, compare with Paystack, database checks, alerts (each has its own slot)
    { name: 'reconciliation', everyMinutes: FINANCE_STEPS_EVERY_MINUTES.reconciliation, run: ({ deadline }) => runFinanceReconciliation(supabase, { deadline }) },
  ]
  return runScheduled(supabase, steps, { budget, force, logger: paymentLogger })
}
