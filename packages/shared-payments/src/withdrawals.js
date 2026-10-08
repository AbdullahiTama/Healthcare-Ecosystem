// Withdrawal lifecycle logic shared by CareFind (CareCoin withdrawals) and CareHub (business withdrawals).
//
// The database owns every state change (settle_withdrawal / settle_business_withdrawal: replay-safe, refund at
// most once, amount-checked). This module only decides WHAT to tell it - from a provider webhook, from asking
// Paystack about a request that looks stuck, or from an admin - and reports what happened so each app can run
// its own side effects (trust tiers, emails). It never writes a request table itself.

import { rpcWithRetry } from './rpcRetry.js'
import { createLoopGuard } from './scheduler.js'

export const IN_FLIGHT_GRACE_MS = 10 * 60 * 1000

const IN_FLIGHT = new Set(['pending', 'otp', 'processing', 'queued', 'received'])
const NOT_PAID = new Set(['failed', 'reversed', 'abandoned', 'blocked', 'rejected'])

export const WITHDRAWAL_KINDS = {
  carefind: { settleRpc: 'settle_withdrawal', table: 'withdrawal_requests', columns: 'id, user_id, amount, payout_kobo, status, paystack_reference, paystack_transfer_code, created_at' },
  carehub: { settleRpc: 'settle_business_withdrawal', table: 'business_withdrawal_requests', columns: 'id, business_id, amount, status, paystack_reference, paystack_transfer_code, created_at' },
}

export const TRANSFER_EVENT_OUTCOMES = {
  'transfer.success': 'success',
  'transfer.failed': 'failed',
  'transfer.reversed': 'reversed',
}

// Results the database returns that mean "somebody must look at this": money may have moved against our books.
export const ATTENTION_RESULTS = new Set(['conflict_paid_after_refund', 'conflict_failed_after_completed', 'amount_mismatch'])

/**
 * Ask Paystack by reference what became of a transfer. -> 'success' | 'failed' | ... | 'not_found'
 * @param {(path: string) => Promise<any>} fetcher   the app's Paystack fetch (returns the parsed body)
 */
export async function getTransferStatus(reference, fetcher) {
  const data = await fetcher(`/transfer/verify/${encodeURIComponent(reference)}`)
  if (data && data.status) return String(data.data?.status || '').toLowerCase()
  if (/not found/i.test(data?.message || '')) return 'not_found'
  throw new Error(data?.message || 'Could not verify transfer')
}

/**
 * Decide what to do about a request that is not settled. -> { action: 'refund' | 'complete' | 'wait', message?, providerStatus? }
 * A refund is only ever chosen once Paystack itself says the transfer did not (and will not) happen: a timeout can
 * mean the transfer was created anyway, and refunding then pays twice.
 * @param {object} row  { paystack_reference, paystack_transfer_code, created_at }
 * @param {object} opts { getStatus(reference), now, graceMs, referenceless: 'wait' | 'refund' }
 */
export async function decideTransferAction(row, { getStatus, now = Date.now(), graceMs = IN_FLIGHT_GRACE_MS, referenceless = 'wait' } = {}) {
  if (!row?.paystack_reference) {
    return referenceless === 'refund' ? { action: 'refund' } : { action: 'wait', message: 'No transfer reference on this request.' }
  }
  const ageMs = now - new Date(row.created_at).getTime()
  const hasCode = Boolean(row.paystack_transfer_code)
  if (!hasCode && !(ageMs >= graceMs)) {
    return { action: 'wait', message: 'Filed moments ago; its transfer may still be sending. Try again in a few minutes.' }
  }

  let status
  try {
    status = await getStatus(row.paystack_reference)
  } catch (err) {
    return { action: 'wait', message: `Could not confirm the transfer with Paystack (${err.message}). Nothing was refunded.` }
  }

  if (status === 'success') return { action: 'complete', providerStatus: status, message: 'The transfer already succeeded at Paystack, so it was marked completed instead of refunded.' }
  if (IN_FLIGHT.has(status)) return { action: 'wait', providerStatus: status, message: `The transfer is still ${status} at Paystack. Wait for it to settle.` }
  if (NOT_PAID.has(status)) return { action: 'refund', providerStatus: status }
  // 'not_found' is only believable once the transfer call has had time to finish and never saved a code;
  // with a code on file Paystack must know the transfer.
  if (status === 'not_found' && !hasCode) return { action: 'refund', providerStatus: status }
  return { action: 'wait', providerStatus: status, message: `Unrecognised Paystack transfer status "${status}". Nothing was refunded.` }
}

/** Apply one provider outcome to one request (by reference or exact id). -> the database's result object. Throws on an RPC error. */
export async function settleWithdrawal(supabase, kind, { outcome, reference, requestId, amountKobo, detail } = {}) {
  const def = WITHDRAWAL_KINDS[kind]
  if (!def) throw new Error(`unknown withdrawal kind ${kind}`)
  const { data, error } = await rpcWithRetry(supabase, def.settleRpc, {
    p_outcome: outcome,
    p_reference: requestId ? null : reference ?? null,
    p_request_id: requestId ?? null,
    p_amount_kobo: amountKobo ?? null,
    p_detail: detail ?? null,
  })
  if (error) throw new Error(`${def.settleRpc}: ${error.message}`)
  return data || { result: 'not_found' }
}

/**
 * Settle the outcome a Paystack transfer webhook reports. The reference identifies the request exactly; both apps'
 * tables are tried because the shared endpoint serves both (a reference exists in at most one).
 * -> { handled: boolean, outcome?, kind?, result? }
 */
export async function settleTransferWebhook(supabase, event, { logger = console } = {}) {
  const outcome = TRANSFER_EVENT_OUTCOMES[event?.event]
  const reference = event?.data?.reference
  if (!outcome || !reference) return { handled: false }
  const amountKobo = outcome === 'success' && Number.isFinite(Number(event.data.amount)) ? Math.round(Number(event.data.amount)) : null
  for (const kind of Object.keys(WITHDRAWAL_KINDS)) {
    const result = await settleWithdrawal(supabase, kind, { outcome, reference, amountKobo, detail: event.event })
    if (result.result === 'not_found') continue
    if (ATTENTION_RESULTS.has(result.result)) {
      logger.error?.('withdrawal.needs_attention', { kind, event: event.event, reference, result: result.result, id: result.id })
    }
    return { handled: true, outcome, kind, result }
  }
  return { handled: true, outcome, kind: null, result: { result: 'not_found' } }
}

/**
 * Decide and settle one request that looks stuck. -> { outcome: 'refunded' | 'completed' | 'waiting', detail?, result? }
 * 'completed'/'refunded' are reported ONLY when this call changed the request, so a caller's side effects (trust, email)
 * cannot run twice.
 */
export async function reconcileWithdrawal(supabase, kind, row, opts = {}) {
  const decision = await decideTransferAction(row, opts)
  if (decision.action === 'wait') return { outcome: 'waiting', detail: decision.message }

  const outcome = decision.action === 'refund' ? 'failed' : 'success'
  let result
  try {
    result = await settleWithdrawal(supabase, kind, { outcome, requestId: row.id, detail: opts.detail || `reconcile:${decision.providerStatus || 'unconfirmed'}` })
  } catch (err) {
    return { outcome: 'waiting', detail: err.message }
  }
  if (result.result === 'refunded') return { outcome: 'refunded', result }
  if (result.result === 'completed') return { outcome: 'completed', result, message: decision.message }
  // already_* means a webhook/admin settled it first; conflicts need a human
  return { outcome: 'waiting', detail: result.result, result }
}

/** Sweep every request still reserved/processing after the grace period. Hooks run only for changes this sweep made. */
export async function sweepWithdrawals(supabase, kind, { limit = 50, now = Date.now(), graceMs = IN_FLIGHT_GRACE_MS, getStatus, onRefunded, onCompleted, logger = console, deadline = null } = {}) {
  const def = WITHDRAWAL_KINDS[kind]
  const cutoff = new Date(now - graceMs).toISOString()
  const { data: rows, error } = await supabase
    .from(def.table)
    .select(def.columns)
    .in('status', ['reserved', 'processing'])
    .not('paystack_reference', 'is', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const summary = { checked: 0, refunded: 0, completed: 0, waiting: 0, errors: 0 }
  const guard = createLoopGuard({ deadline })
  for (const row of rows || []) {
    if (guard.stop()) { summary.stopped = guard.reason; break }
    summary.checked++
    try {
      const r = await reconcileWithdrawal(supabase, kind, row, { getStatus, now, graceMs })
      guard.success()
      summary[r.outcome]++
      if (r.outcome === 'refunded') {
        logger.warn?.('withdrawal.sweep.refunded', { kind, id: row.id, reference: row.paystack_reference })
        await onRefunded?.(row, r.result)
      }
      if (r.outcome === 'completed') await onCompleted?.(row, r.result)
    } catch (err) {
      summary.errors++
      guard.failure(err)
      logger.error?.('withdrawal.sweep.failed', { kind, id: row.id, reference: row.paystack_reference, message: err.message })
    }
  }
  return summary
}

/** Normalise an account name for comparison: trim, collapse whitespace, lower-case. */
export function normalizeAccountName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

const ACCOUNT_CHECK_FAILED = 'Could not verify account details. Check the bank and account number and try again.'

/**
 * Check that the typed account name belongs to the account number BEFORE any money is reserved, so a typo (or a
 * hostile payee) cannot route a payout to the wrong account. If Paystack says the bank does not support name
 * resolution, the typed name is accepted (the same UX as the resolve-account endpoint).
 * -> { ok: true, accountName } | { ok: false, status, error }
 * @param {(args: {bankCode: string, accountNumber: string}) => Promise<{accountName: string}>} resolveAccount
 */
export async function verifyBankAccount(resolveAccount, { bankCode, accountNumber, accountName }) {
  let resolved
  try {
    resolved = await resolveAccount({ bankCode, accountNumber })
  } catch (err) {
    const msg = err.paystackMessage || err.message || ''
    if (/not supported|does not support|unable to resolve|cannot resolve/i.test(msg)) {
      const typed = String(accountName || '').trim()
      return typed ? { ok: true, accountName: typed, unverified: true } : { ok: false, status: 400, error: ACCOUNT_CHECK_FAILED }
    }
    return { ok: false, status: 400, error: ACCOUNT_CHECK_FAILED }
  }
  if (!resolved || !resolved.accountName) return { ok: false, status: 400, error: ACCOUNT_CHECK_FAILED }
  const submitted = normalizeAccountName(accountName)
  if (!submitted || submitted !== normalizeAccountName(resolved.accountName)) {
    return { ok: false, status: 400, error: 'Account name does not match the account number. Use the name registered with your bank.' }
  }
  return { ok: true, accountName: resolved.accountName }
}
