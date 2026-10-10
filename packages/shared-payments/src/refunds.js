// Refund lifecycle logic shared by CareFind and CareHub (the Refund Engine's Node side).
//
// The DATABASE owns every state change and every ledger movement (request_refund / mark_refund_processing /
// settle_refund). This module decides what to tell it: it asks for the refund, calls the provider AFTER the request has
// committed (no lock held), and turns the provider's answer - synchronous, webhook, or a later sweep - into exactly one
// settle call. A card refund is `completed` only when the PROVIDER says so; "we asked" is never "done".

import { isProviderError } from './errors.js'
import { rpcWithRetry } from './rpcRetry.js'
import { createLoopGuard } from './scheduler.js'

export const REFUND_GRACE_MS = 10 * 60 * 1000

export const REFUND_EVENT_OUTCOMES = {
  'refund.processed': 'processed',
  'refund.failed': 'failed',
  'refund.pending': 'processing',
  'refund.processing': 'processing',
}

// Results that mean "somebody must look at this": money may have moved against our books.
export const REFUND_ATTENTION_RESULTS = new Set(['conflict_processed_after_failed', 'conflict_failed_after_completed', 'amount_mismatch'])

// A provider that refuses a refund because it already exists/has happened has NOT failed it.
const ALREADY_DONE = /already|fully (refunded|reversed)|has been (refunded|reversed)|duplicate/i

// After the database flipped a refund to `completed`, the app gets one chance to tell the payer (their email).
// Fires ONLY on the flip - a replay that found the row already completed was not the changer - and never throws:
// the settle already committed, so a broken effect may be logged but must not turn success into failure.
async function notifySettled(onSettled, result, logger) {
  if (!onSettled || result?.result !== 'completed') return
  try {
    await onSettled(result)
  } catch (err) {
    logger?.error?.('refund.on_settled_failed', { id: result?.id, message: err?.message })
  }
}

/** Ask the database for a refund (idempotent: one live refund per payment). -> the database's answer ({ outcome, id, reference, ... }) */
export async function requestRefund(supabase, { cause, entityType, entityId, requestedBy = null, reason = null, platformFunded = false }) {
  const { data, error } = await rpcWithRetry(supabase, 'request_refund', {
    p_cause: cause, p_entity_type: entityType, p_entity_id: entityId,
    p_requested_by: requestedBy, p_reason: reason, p_platform_funded: platformFunded,
  })
  if (error) throw new Error(`request_refund: ${error.message}`)
  return data || { outcome: 'not_found' }
}

/** Apply one provider outcome to one refund. Throws on an RPC error. -> { result, ... } */
export async function settleRefund(supabase, { outcome, id, reference, providerRefundId, transactionReference, amountKobo, detail } = {}) {
  const { data, error } = await rpcWithRetry(supabase, 'settle_refund', {
    p_outcome: outcome, p_refund_id: id ?? null, p_reference: id ? null : reference ?? null,
    p_provider_refund_id: providerRefundId ?? null, p_transaction_reference: transactionReference ?? null,
    p_amount_kobo: amountKobo ?? null, p_detail: detail ?? null,
  })
  if (error) throw new Error(`settle_refund: ${error.message}`)
  return data || { result: 'not_found' }
}

async function markProcessing(supabase, id, providerRefundId, providerStatus) {
  const { data, error } = await supabase.rpc('mark_refund_processing', { p_refund_id: id, p_provider_refund_id: providerRefundId || null, p_provider_status: providerStatus || null })
  if (error) throw new Error(`mark_refund_processing: ${error.message}`)
  return data
}

/**
 * Send a requested card/platform-funded refund to the provider and record its answer.
 * -> { state: 'completed' | 'processing' | 'failed' | 'pending', result?, detail? }
 *   completed   the provider confirmed it (settled as processed)
 *   processing  the provider accepted it; the webhook or the sweep finishes it
 *   failed      the provider definitively refused (the business is restored)
 *   pending     we could not tell (timeout, our own configuration): left `requested` for the sweep - NEVER failed on a guess
 * @param {{ id: string, reference: string, amount_kobo: number, provider_transaction_reference: string }} refund  request_refund's answer
 * @param {(result: object) => Promise<void>} [opts.onSettled]  called once, when THIS call flips the refund completed
 */
export async function executeCardRefund(supabase, provider, refund, { reason = 'Refund', logger = console, onSettled = null } = {}) {
  let answer
  try {
    answer = await provider.refundPayment({ reference: refund.provider_transaction_reference, amountKobo: Number(refund.amount_kobo), reason })
  } catch (err) {
    if (isProviderError(err)) {
      if (ALREADY_DONE.test(err.message || '')) {
        // The provider already has (or has done) this refund: wait for its webhook / the sweep, do not fail or repeat it.
        await markProcessing(supabase, refund.id, null, 'already_exists').catch(() => {})
        return { state: 'processing', detail: err.message }
      }
      // Only a definite business-level refusal means the refund does not exist. Anything ambiguous or ours (timeout,
      // network, auth, config, rate limit) is retried later, never turned into a failure.
      if (!err.ambiguous && (err.code === 'provider_rejected' || err.code === 'invalid_request' || err.code === 'not_found')) {
        const result = await settleRefund(supabase, { outcome: 'failed', id: refund.id, detail: `provider_refused: ${err.message}`.slice(0, 300) })
        return { state: 'failed', result, detail: err.message }
      }
      logger.error?.('refund.provider_call_unresolved', { refund: refund.reference, code: err.code, ambiguous: err.ambiguous, message: err.message })
      return { state: 'pending', detail: err.message }
    }
    logger.error?.('refund.provider_call_crashed', { refund: refund.reference, message: err?.message })
    return { state: 'pending', detail: err?.message }
  }

  if (answer.status === 'completed') {
    const result = await settleRefund(supabase, { outcome: 'processed', id: refund.id, providerRefundId: answer.providerRefundId, amountKobo: answer.amountKobo ?? undefined })
    await notifySettled(onSettled, result, logger)
    return { state: result.result === 'completed' || result.result === 'already_completed' ? 'completed' : 'pending', result }
  }
  if (answer.status === 'failed') {
    const result = await settleRefund(supabase, { outcome: 'failed', id: refund.id, providerRefundId: answer.providerRefundId, detail: 'provider_failed' })
    return { state: 'failed', result }
  }
  await markProcessing(supabase, refund.id, answer.providerRefundId, 'processing')
  return { state: 'processing' }
}

/**
 * Settle the outcome a Paystack refund webhook reports. The payment reference identifies the refund (one live refund per
 * payment); the provider's own refund id is used when we already have it.
 * -> { handled: boolean, outcome?, result? }
 */
export async function settleRefundWebhook(supabase, event, { logger = console, onSettled = null } = {}) {
  const outcome = REFUND_EVENT_OUTCOMES[event?.event]
  const d = event?.data || {}
  const transactionReference = d.transaction_reference || d.transaction?.reference || null
  const providerRefundId = d.id != null ? String(d.id) : null
  if (!outcome || (!transactionReference && !providerRefundId)) return { handled: false }
  const amountKobo = outcome === 'processed' && Number.isSafeInteger(Number(d.amount)) ? Number(d.amount) : null
  const result = await settleRefund(supabase, { outcome, providerRefundId, transactionReference, amountKobo, detail: event.event })
  if (REFUND_ATTENTION_RESULTS.has(result.result)) {
    logger.error?.('refund.needs_attention', { event: event.event, transactionReference, providerRefundId, result: result.result, id: result.id })
  }
  await notifySettled(onSettled, result, logger)
  return { handled: true, outcome, result }
}

/**
 * Finish refunds the provider has not answered. Each is looked up at the provider FIRST; only a `requested` refund the provider
 * has never heard of is sent (a timed-out call may have created it). `processing` ones are completed or failed from the answer.
 * -> { checked, completed, failed, processing, pending, errors }
 */
export async function sweepRefunds(supabase, provider, { limit = 50, now = Date.now(), graceMs = REFUND_GRACE_MS, logger = console, deadline = null, onSettled = null } = {}) {
  const cutoff = new Date(now - graceMs).toISOString()
  const { data: rows, error } = await supabase
    .from('refunds')
    .select('id, reference, status, kind, amount_kobo, provider_transaction_reference, created_at')
    .in('status', ['requested', 'processing'])
    .in('kind', ['card', 'platform_funded'])
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const summary = { checked: 0, completed: 0, failed: 0, processing: 0, pending: 0, errors: 0 }
  const guard = createLoopGuard({ deadline })
  for (const row of rows || []) {
    if (guard.stop()) { summary.stopped = guard.reason; break }
    summary.checked++
    try {
      // ALWAYS ask the provider first: a `requested` refund whose call timed out may exist at the provider, and sending it
      // again must not be how we find out.
      let answer = null
      try {
        answer = await provider.verifyRefund({ reference: row.provider_transaction_reference })
        guard.success()
      } catch (err) {
        guard.failure(err)
        if (err?.code !== 'not_found') {
          summary.pending++
          logger.error?.('refund.sweep.lookup_failed', { refund: row.reference, code: err?.code, message: err?.message })
          continue
        }
      }

      if (!answer) {
        // the provider has no refund for this payment: only a `requested` one may be sent now
        if (row.status !== 'requested') { summary.pending++; continue }
        const r = await executeCardRefund(supabase, provider, { ...row }, { logger, onSettled })
        summary[r.state]++
        continue
      }
      if (answer.status === 'completed') {
        const r = await settleRefund(supabase, { outcome: 'processed', id: row.id, providerRefundId: answer.providerRefundId, amountKobo: answer.amountKobo ?? undefined })
        await notifySettled(onSettled, r, logger)
        summary[r.result === 'completed' ? 'completed' : 'pending']++
      } else if (answer.status === 'failed') {
        const r = await settleRefund(supabase, { outcome: 'failed', id: row.id, providerRefundId: answer.providerRefundId, detail: 'provider_failed' })
        summary[r.result === 'failed' ? 'failed' : 'pending']++
      } else {
        if (row.status === 'requested') await markProcessing(supabase, row.id, answer.providerRefundId, 'processing')
        summary.processing++
      }
    } catch (err) {
      summary.errors++
      logger.error?.('refund.sweep.failed', { refund: row.reference, message: err.message })
    }
  }
  return summary
}

/**
 * Appointments that were cancelled while paid by card or CareCoins but never got a refund (the cancel call died between
 * cancelling and refunding). Requests and sends the refund (idempotent). -> same shape as refundUnappliedPayments
 */
export async function refundCancelledAppointments(supabase, provider, { limit = 25, logger = console, deadline = null, onSettled = null } = {}) {
  const { data: appts, error } = await supabase
    .from('appointments')
    .select('id')
    .eq('status', 'cancelled')
    .eq('payment_status', 'paid')
    .in('payment_channel', ['card', 'carecoins'])
    .order('cancelled_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const summary = { checked: 0, requested: 0, alreadyRequested: 0, completed: 0, processing: 0, failed: 0, pending: 0, errors: 0 }
  const guard = createLoopGuard({ deadline })
  for (const a of appts || []) {
    if (guard.stop()) { summary.stopped = guard.reason; break }
    summary.checked++
    try {
      const refund = await requestRefund(supabase, { cause: 'booking_cancelled', entityType: 'appointment', entityId: a.id, reason: 'appointment cancelled' })
      if (refund.outcome === 'already_requested') { summary.alreadyRequested++; continue }
      if (refund.outcome === 'completed') { summary.requested++; summary.completed++; continue }
      if (refund.outcome !== 'requested') continue
      summary.requested++
      const r = await executeCardRefund(supabase, provider, refund, { reason: 'Appointment cancelled', logger, onSettled })
      summary[r.state]++
    } catch (err) {
      summary.errors++
      logger.error?.('refund.cancelled.failed', { appointment: a.id, message: err.message })
    }
  }
  return summary
}

/** Everything the refund cron does, each part independent (one failing never stops the others). */
export async function runRefundSweeps(supabase, provider, { logger = console, deadline = null, onSettled = null } = {}) {
  const out = {}
  for (const [name, job] of [['sweep', sweepRefunds], ['unapplied', refundUnappliedPayments], ['cancelled', refundCancelledAppointments]]) {
    try { out[name] = await job(supabase, provider, { logger, deadline, onSettled }) } catch (err) { out[name] = { error: err.message }; logger.error?.('refund.cron.failed', { job: name, message: err.message }) }
  }
  return out
}

/**
 * Payments that could not be applied (payment_intents.needs_refund) are refunded in full. Requests the refund (idempotent) and
 * sends it. -> { checked, requested, alreadyRequested, completed, processing, failed, pending, errors }
 */
export async function refundUnappliedPayments(supabase, provider, { limit = 25, logger = console, deadline = null, onSettled = null } = {}) {
  const { data: intents, error } = await supabase
    .from('payment_intents')
    .select('id, reference')
    .eq('status', 'needs_refund')
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const summary = { checked: 0, requested: 0, alreadyRequested: 0, completed: 0, processing: 0, failed: 0, pending: 0, errors: 0 }
  const guard = createLoopGuard({ deadline })
  for (const intent of intents || []) {
    if (guard.stop()) { summary.stopped = guard.reason; break }
    summary.checked++
    try {
      const refund = await requestRefund(supabase, { cause: 'needs_refund_intent', entityType: 'payment_intent', entityId: intent.id, reason: 'payment could not be applied' })
      if (refund.outcome === 'already_requested') { summary.alreadyRequested++; continue }
      if (refund.outcome !== 'requested') continue
      summary.requested++
      const r = await executeCardRefund(supabase, provider, refund, { reason: 'Payment could not be applied', logger, onSettled })
      summary[r.state]++
    } catch (err) {
      summary.errors++
      guard.failure(err)
      logger.error?.('refund.unapplied.failed', { intent: intent.reference, message: err.message })
    }
  }
  return summary
}
