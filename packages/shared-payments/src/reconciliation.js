// Phase 11: recovery and reconciliation, shared by CareFind and CareHub.
//
// The engines settle money correctly when they are TOLD about it. This module is what notices when nobody told them, and what
// compares our books with the provider's:
//
//   replayProviderEvents          a webhook that was stored but failed (Paystack gives up after a few days) or never finished is
//                                 processed again from its stored payload, through the same processor the live webhook uses.
//   sweepOpenIntents              a payment the customer made but whose redirect AND webhook never settled it: the provider is
//                                 asked directly, and the ONE settlement engine settles it. Abandoned attempts past their expiry
//                                 are closed.
//   reconcileProviderTransactions Paystack's own list of successful charges against our payment intents: a charge no intent
//                                 recognises, an amount that differs from what was expected, a payment never settled.
//   runDbReconciliation           every database check (coins, commissions, withdrawals, refunds, shop vendor credits, intents,
//                                 webhook events) -> reconciliation_findings.
//
// Nothing here moves money by itself: settlement is always settle_payment_intent, and findings are only ever REPORTED.
// Every step is isolated: one failing never stops the others, and every step is safe to run twice or concurrently.

import { findIntent } from './intents.js'
import { settleByReference } from './settlement.js'
import { finishProviderEvent } from './events.js'
import { ERROR_CODES, isProviderError } from './errors.js'

const quietLogger = { info() {}, warn() {}, error() {} }

const rpc = async (supabase, name, args = {}) => {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

/** Run every database check and sync the findings. -> { run_id, sources, totals } */
export async function runDbReconciliation(supabase) {
  return rpc(supabase, 'run_db_reconciliation')
}

/**
 * Process stored webhook events again.
 * @param {object} p
 * @param {(payload: object) => Promise<'processed'|'ignored'>} p.process   the SAME function the live webhook uses
 * @returns {Promise<{ checked: number, processed: number, ignored: number, failed: number }>}
 */
export async function replayProviderEvents(supabase, { process, olderThanMinutes = 10, maxAttempts = 20, limit = 50, logger = quietLogger } = {}) {
  if (typeof process !== 'function') throw new TypeError('replayProviderEvents needs a process function')
  const rows = (await rpc(supabase, 'list_replayable_provider_events', {
    p_older_than_minutes: olderThanMinutes, p_max_attempts: maxAttempts, p_limit: limit,
  })) || []
  const summary = { checked: rows.length, processed: 0, ignored: 0, failed: 0 }
  for (const row of rows) {
    try {
      const outcome = await process(row.payload)
      await finishProviderEvent(supabase, row, { outcome })
      summary[outcome === 'ignored' ? 'ignored' : 'processed']++
      logger.info('webhook.replayed', { eventId: row.event_id, outcome })
    } catch (err) {
      summary.failed++
      logger.warn('webhook.replay_failed', { eventId: row.event_id, attempts: (row.attempts || 0) + 1, message: err.message })
      await finishProviderEvent(supabase, row, { outcome: 'failed', error: err.message }).catch(() => {})
    }
  }
  return summary
}

/**
 * Ask the provider about payment attempts that are still open after a while, and settle the ones that were paid.
 * @param {(result: object) => Promise<void>} [p.onSettled]  runs the app's side effects (emails, notices) for a payment THIS sweep settled
 * @returns {Promise<{ checked, settled, alreadySettled, notPaid, expired, needsRefund, errors }>}
 */
export async function sweepOpenIntents(supabase, provider, { olderThanMinutes = 15, limit = 50, onSettled, logger = quietLogger } = {}) {
  const rows = (await rpc(supabase, 'list_open_intents_to_check', { p_older_than_minutes: olderThanMinutes, p_limit: limit })) || []
  const summary = { checked: rows.length, settled: 0, alreadySettled: 0, notPaid: 0, expired: 0, needsRefund: 0, errors: 0 }
  // Every attempt is recorded (even a failed one) so the database backs off instead of asking again next minute.
  if (rows.length) await rpc(supabase, 'mark_intents_checked', { p_ids: rows.map((r) => r.id) }).catch((err) => logger.warn('payment.sweep_mark_failed', { message: err.message }))
  for (const row of rows) {
    try {
      const result = await settleByReference({ supabase, provider, reference: row.reference, logger })
      if (result.outcome === 'settled') {
        summary.settled++
        logger.warn('payment.recovered_by_sweep', { reference: row.reference, purpose: result.purpose })
        if (onSettled) await onSettled(result)
      } else if (result.outcome === 'already_settled') summary.alreadySettled++
      else if (result.outcome === 'needs_refund') { summary.needsRefund++; logger.error('payment.needs_refund', { reference: row.reference, reason: result.reason }) }
      else if (result.outcome === 'not_paid') {
        summary.notPaid++
        // never paid and past its expiry: close it (the state machine allows created/pending -> expired)
        if (['created', 'pending'].includes(row.status) && new Date(row.expires_at) < new Date() && ['pending', 'abandoned', 'failed'].includes(result.providerStatus)) {
          const { error } = await supabase.from('payment_intents').update({ status: 'expired' }).eq('id', row.id).in('status', ['created', 'pending'])
          if (!error) summary.expired++
        }
      } else summary.errors++
    } catch (err) {
      // "reference not found" at the provider = the customer never reached checkout: close it once it has expired, otherwise leave it
      if (isProviderError(err) && err.code === ERROR_CODES.REJECTED && /not found/i.test(err.message) && ['created', 'pending'].includes(row.status) && new Date(row.expires_at) < new Date()) {
        const { error } = await supabase.from('payment_intents').update({ status: 'expired' }).eq('id', row.id).in('status', ['created', 'pending'])
        if (!error) { summary.expired++; summary.notPaid++; continue }
      }
      summary.errors++
      logger.warn('payment.sweep_failed', { reference: row.reference, code: err.code, message: err.message })
    }
  }
  return summary
}

/**
 * Compare the provider's list of successful charges with our payment intents and record the differences as findings.
 *   charge_without_intent   money received that no intent recognises (another integration, or a payment from before intents)
 *   amount_mismatch         the provider took a different amount than the intent expected
 *   transaction_id_mismatch our intent names a different provider transaction than the one the provider lists
 *   paid_not_settled        the provider says paid, our intent is still open: settlement is attempted right here, and only a
 *                           payment that STILL is not settled stays a finding
 * @returns {Promise<{ scanned, skipped, findings, recovered, pages }>}
 */
export async function reconcileProviderTransactions(supabase, provider, { from, to, maxPages = 20, perPage = 100, onSettled, logger = quietLogger } = {}) {
  const txns = []
  let skipped = 0
  let pages = 0
  for (let page = 1; page <= maxPages; page++) {
    const r = await provider.listTransactions({ from, to, status: 'success', page, perPage })
    pages++
    skipped += r.skipped || 0
    txns.push(...r.transactions)
    if (!r.hasMore) break
  }

  const current = []
  const scanned = []
  let recovered = 0
  for (const tx of txns) {
    scanned.push(tx.reference)
    const intent = await findIntent(supabase, tx.reference)
    if (!intent) {
      current.push({ kind: 'charge_without_intent', subject_type: 'payment_reference', subject_id: tx.reference, severity: 'critical',
        detail: `Paystack received ${tx.amountKobo / 100} ${tx.currency} (${tx.paidAt || 'unknown time'}, ${tx.channel || 'unknown channel'}) that no payment intent recognises` })
      continue
    }
    if (Number(intent.expected_amount) !== tx.amountKobo) {
      current.push({ kind: 'amount_mismatch', subject_type: 'payment_reference', subject_id: tx.reference, severity: 'critical',
        detail: `Paystack took ${tx.amountKobo} kobo but the intent (${intent.purpose}, ${intent.status}) expected ${intent.expected_amount}` })
      continue
    }
    if (intent.provider_transaction_id && String(intent.provider_transaction_id) !== tx.providerTransactionId) {
      current.push({ kind: 'transaction_id_mismatch', subject_type: 'payment_reference', subject_id: tx.reference, severity: 'critical',
        detail: `intent is bound to provider transaction ${intent.provider_transaction_id} but Paystack lists ${tx.providerTransactionId}` })
      continue
    }
    if (['created', 'pending', 'verified', 'failed', 'expired'].includes(intent.status)) {
      // Paid at the provider, still open here: settle it now (the engine re-verifies with the provider and is idempotent).
      try {
        const result = await settleByReference({ supabase, provider, reference: tx.reference, logger })
        if (result.outcome === 'settled') {
          recovered++
          logger.warn('payment.recovered_by_reconciliation', { reference: tx.reference, purpose: result.purpose })
          if (onSettled) await onSettled(result)
          continue
        }
        if (['already_settled', 'needs_refund'].includes(result.outcome)) continue
        current.push({ kind: 'paid_not_settled', subject_type: 'payment_reference', subject_id: tx.reference, severity: 'critical',
          detail: `Paystack says paid (${tx.amountKobo} kobo) but the intent (${intent.purpose}) is ${intent.status}; settlement answered ${result.outcome}${result.reason ? ` (${result.reason})` : ''}` })
      } catch (err) {
        current.push({ kind: 'paid_not_settled', subject_type: 'payment_reference', subject_id: tx.reference, severity: 'critical',
          detail: `Paystack says paid (${tx.amountKobo} kobo) but the intent (${intent.purpose}) is ${intent.status}; settlement failed: ${String(err.message).slice(0, 200)}` })
      }
    }
  }

  await rpc(supabase, 'sync_reconciliation_findings', { p_source: 'provider', p_current: current, p_scope: scanned })
  return { scanned: scanned.length, skipped, findings: current.length, recovered, pages }
}

/**
 * Tell the administrators about critical findings, once each (then a reminder every `remindHours` while they stay open and
 * unacknowledged). The database hands every finding to exactly one caller; if the message cannot be queued the claim is released so
 * the next pass tries again, and the error is rethrown.
 * @param {(findings: object[]) => Promise<void>} p.send   queue the alert email(s); throws if it could not
 * @returns {Promise<{ claimed: number }>}
 */
export async function alertOnCriticalFindings(supabase, { send, remindHours = 24, logger = quietLogger } = {}) {
  if (typeof send !== 'function') throw new TypeError('alertOnCriticalFindings needs a send function')
  const findings = (await rpc(supabase, 'claim_findings_to_alert', { p_remind_hours: remindHours, p_limit: 100 })) || []
  if (!findings.length) return { claimed: 0 }
  try {
    await send(findings)
  } catch (err) {
    await rpc(supabase, 'release_finding_alerts', { p_ids: findings.map((f) => f.id) }).catch(() => {})
    logger.error('reconciliation.alert_failed', { count: findings.length, message: err.message })
    throw err
  }
  logger.warn('reconciliation.alerted', { count: findings.length })
  return { claimed: findings.length }
}

// How often each step is due (minutes). The cron endpoint runs every minute; Paystack and the database should not be asked that often.
export const RECONCILIATION_SCHEDULE = Object.freeze({ replay: 5, sweep: 5, provider: 30, db: 10, alert: 5 })

/**
 * One reconciliation pass: replay, sweep, compare with the provider, the database checks (last, so they see the repairs), then the
 * alert for anything critical. Each step runs only when it is due (an atomic database gate shared by every instance), unless `force`
 * (an administrator pressing "run now"). Every step is isolated. -> { replay, sweep, provider, db, alert, failed: string[] }
 * A step that was not due reports { skipped: 'not_due' }.
 */
export async function runReconciliation(supabase, provider, { processEvent, onSettled, sendAlert, logger = quietLogger, now = () => new Date(), lookbackHours = 48, force = false, schedule = RECONCILIATION_SCHEDULE } = {}) {
  const report = { replay: null, sweep: null, provider: null, db: null, alert: null, failed: [] }
  const due = async (name) => {
    if (force) return true
    try { return Boolean(await rpc(supabase, 'claim_job_slot', { p_job: `recon_${name}`, p_min_minutes: schedule[name] })) } catch (err) {
      // If the gate itself is broken, running is safer than never reconciling
      logger.warn('reconciliation.gate_failed', { step: name, message: err.message })
      return true
    }
  }
  const step = async (name, fn) => {
    if (!(await due(name))) { report[name] = { skipped: 'not_due' }; return }
    try { report[name] = await fn() } catch (err) {
      report[name] = { error: err.message }
      report.failed.push(name)
      logger.error('reconciliation.step_failed', { step: name, message: err.message })
    }
  }
  if (processEvent) await step('replay', () => replayProviderEvents(supabase, { process: processEvent, logger }))
  await step('sweep', () => sweepOpenIntents(supabase, provider, { onSettled, logger }))
  const to = now()
  const from = new Date(to.getTime() - lookbackHours * 3600 * 1000)
  await step('provider', () => reconcileProviderTransactions(supabase, provider, { from: from.toISOString(), to: to.toISOString(), onSettled, logger }))
  await step('db', () => runDbReconciliation(supabase))
  if (sendAlert) await step('alert', () => alertOnCriticalFindings(supabase, { send: sendAlert, logger }))

  const totals = report.db?.totals
  if (totals && (totals.open_critical > 0 || totals.open_warning > 0)) {
    // One structured line an operator can alert on. The findings themselves are in reconciliation_findings.
    logger[totals.open_critical > 0 ? 'error' : 'warn']('reconciliation.open_findings', totals)
  }
  return report
}
