// Recovery for automated withdrawals whose Paystack transfer did not settle cleanly. The decision logic and the
// settlement calls live in shared-payments (one definition for CareFind and CareHub); this file binds them to
// CareFind's Paystack client and its side effects (trust tiers, emails).
//
// A refund is only ever chosen once Paystack confirms the transfer will not happen: a timeout can mean the
// transfer was created anyway, and refunding then pays the user twice. The refund itself is the database's
// settle_withdrawal(): replay-safe, at most once.
import { reconcileWithdrawal as reconcile, sweepWithdrawals as sweep, getTransferStatus } from '@care-ecosystem/shared-payments'
import { paystackFetch } from './paystack.js'
import { applyWithdrawalResult } from './withdrawalEffects.js'

const getStatus = (reference) => getTransferStatus(reference, paystackFetch)

// -> { outcome: 'refunded' | 'completed' | 'waiting', detail? }
export function reconcileWithdrawal(supabase, row, opts = {}) {
  return reconcile(supabase, 'carefind', row, { getStatus, ...opts })
}

// Sweep: every withdrawal still reserved/processing after the grace period, checked against Paystack and settled
// one way or the other. Shared by cron/reconcile-withdrawals.js and the chained call in cron/process-email-outbox.js.
export function sweepWithdrawals(supabase, { limit = 50, ...opts } = {}) {
  return sweep(supabase, 'carefind', {
    limit,
    getStatus,
    // The hooks run only for changes THIS sweep made, so a webhook that settled first is never counted twice.
    onRefunded: (row, result) => applyWithdrawalResult(supabase, 'failed', { ...result, reference: row.paystack_reference }),
    onCompleted: (row, result) => applyWithdrawalResult(supabase, 'success', { ...result, reference: row.paystack_reference }),
    ...opts,
  })
}
