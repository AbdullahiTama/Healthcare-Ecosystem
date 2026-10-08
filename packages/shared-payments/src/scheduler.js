// Running scheduled money work inside a serverless function without letting one slow dependency starve everything else.
//
//   * The cron endpoint is hit every minute but a function has a hard time limit, and every step may call Paystack (8 s per attempt).
//     A step that is not given a deadline can spend the whole invocation, so the steps after it NEVER run. `createBudget` gives the
//     invocation one deadline; `runScheduled` skips a step that no longer fits (it reports `out_of_time` and runs next minute) and
//     hands the deadline to the loops inside the step.
//   * Heavy steps do not need to run every minute: each has an interval, enforced by an atomic database gate shared by every
//     instance and both deployments (claim_job_slot), so two endpoints driven by two crons never do the same work twice.
//   * When the provider is down, asking it fifty more times only burns the budget: `createLoopGuard` stops a loop after a few
//     consecutive provider infrastructure failures (timeout, network, 5xx, rate limit, auth) and reports `provider_unavailable`.
//
// Nothing here moves money; it only decides whether a step starts and whether a loop continues. Every step is idempotent, so being
// stopped half way is safe: the next run picks up where this one left off.

import { isProviderError, ERROR_CODES as E } from './errors.js'

const INFRA_CODES = new Set([E.TIMEOUT, E.NETWORK, E.UNAVAILABLE, E.RATE_LIMITED, E.AUTH, E.CONFIG])

/** A provider failure that says "the provider is not usable right now", as opposed to an answer about one transaction. */
export function isProviderInfraError(err) {
  return isProviderError(err) && INFRA_CODES.has(err.code)
}

/** One deadline for a whole invocation. */
export function createBudget(totalMs, { now = Date.now } = {}) {
  const startedAt = now()
  const deadline = startedAt + totalMs
  return { startedAt, deadline, remainingMs: () => Math.max(0, deadline - now()), expired: () => now() >= deadline }
}

/**
 * Decides, loop iteration by loop iteration, whether to keep going.
 * @returns {{ stop: () => boolean, reason: string|null, success: () => void, failure: (err: any) => void }}
 */
export function createLoopGuard({ deadline = null, maxConsecutiveProviderFailures = 3, now = Date.now } = {}) {
  let consecutive = 0
  let reason = null
  return {
    get reason() { return reason },
    stop() {
      if (reason) return true
      if (deadline != null && now() >= deadline) reason = 'deadline'
      else if (consecutive >= maxConsecutiveProviderFailures) reason = 'provider_unavailable'
      return reason !== null
    },
    success() { consecutive = 0 },
    failure(err) { consecutive = isProviderInfraError(err) ? consecutive + 1 : 0 },
  }
}

/**
 * Run named steps in order, each when it is due and while time remains.
 * @param {object} supabase service-role client
 * @param {{ name: string, everyMinutes: number, run: (ctx: { deadline: number|null }) => Promise<any> }[]} steps
 * @param {object} [o]
 * @param {ReturnType<typeof createBudget>} [o.budget]
 * @param {boolean} [o.force]  run every step now (an administrator pressing "run now"); the budget still applies
 * @param {number} [o.minRemainingMs]  a step does not start with less than this left (default 2000)
 * @returns {Promise<{ report: Record<string, any>, failed: string[] }>}
 *   report[name] = the step's result | { skipped: 'not_due' | 'out_of_time' } | { error }
 */
export async function runScheduled(supabase, steps, { budget = null, force = false, minRemainingMs = 2000, logger = {} } = {}) {
  const report = {}
  const failed = []
  for (const step of steps) {
    if (budget && budget.remainingMs() < minRemainingMs) { report[step.name] = { skipped: 'out_of_time' }; continue }
    if (!force) {
      let due = true
      try {
        const { data, error } = await supabase.rpc('claim_job_slot', { p_job: `job_${step.name}`, p_min_minutes: step.everyMinutes })
        if (error) throw new Error(error.message)
        due = Boolean(data)
      } catch (err) {
        // A broken gate must not stop the money work: run the step (every step is idempotent) and say so.
        logger.warn?.('scheduler.gate_failed', { step: step.name, message: err.message })
      }
      if (!due) { report[step.name] = { skipped: 'not_due' }; continue }
    }
    try {
      report[step.name] = await step.run({ deadline: budget ? budget.deadline : null })
    } catch (err) {
      report[step.name] = { error: err.message }
      failed.push(step.name)
      logger.error?.('scheduler.step_failed', { step: step.name, message: err.message })
    }
  }
  return { report, failed }
}
