// Recovery for business withdrawals whose Paystack transfer did not settle cleanly. The decision logic and the
// settlement calls live in shared-payments (one definition for CareFind and CareHub); this file binds them to
// CareHub's Paystack client.
//
// A refund is only ever chosen once Paystack confirms the transfer will not happen: a timeout can mean the
// transfer was created anyway, and refunding then pays the business twice. The refund itself is the database's
// settle_business_withdrawal(): replay-safe, at most once.
import { reconcileWithdrawal, sweepWithdrawals, getTransferStatus, IN_FLIGHT_GRACE_MS } from '@care-ecosystem/shared-payments'
import { paystackFetch } from './paystack.js'
import { applyBusinessWithdrawalResult } from './businessWithdrawalEffects.js'

export { IN_FLIGHT_GRACE_MS }

const getStatus = (reference) => getTransferStatus(reference, paystackFetch)

// -> { outcome: 'refunded' | 'completed' | 'waiting', detail? }
export function reconcileBusinessWithdrawal(supabase, row, opts = {}) {
  return reconcileWithdrawal(supabase, 'carehub', row, { getStatus, ...opts })
}

// Sweep: every business withdrawal still reserved/processing after the grace period, checked against Paystack and
// settled one way or the other. Shared by cron/reconcile-payments.js.
export function reconcileBusinessWithdrawals(supabase, { limit = 50, ...opts } = {}) {
  return sweepWithdrawals(supabase, 'carehub', {
    limit,
    getStatus,
    // The hooks run only for changes THIS sweep made, so a webhook that settled first is never counted twice.
    onRefunded: (row, result) => applyBusinessWithdrawalResult(supabase, { ...result, reference: row.paystack_reference }),
    onCompleted: (row, result) => applyBusinessWithdrawalResult(supabase, { ...result, reference: row.paystack_reference }),
    ...opts,
  })
}
