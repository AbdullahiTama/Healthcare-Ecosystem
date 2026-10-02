// Recovery for automated withdrawals whose Paystack transfer did not settle cleanly.
//
// initiate-withdrawal.js debits the wallet (request_withdrawal) and only then calls
// Paystack. If that call fails, the coins are gone and no money moved. Refunding is
// only safe once Paystack confirms the transfer will not happen, because a timeout
// can mean the transfer was created anyway; refunding then pays the user twice. So every
// recovery path asks Paystack by reference and applies the same decision the admin
// reject uses (decideAdminReject): success -> completed, in flight -> wait, failed or
// never created -> refund through the atomic reject_withdrawal_request RPC.

import { decideAdminReject } from './withdrawalAdmin.js'

// -> { outcome: 'refunded' | 'completed' | 'waiting', detail? }
export async function reconcileWithdrawal(supabase, row, opts = {}) {
  const decision = await decideAdminReject(row, opts)

  if (decision.action === 'refund') {
    const { data, error } = await supabase.rpc('reject_withdrawal_request', { p_request_id: row.id })
    if (error) return { outcome: 'waiting', detail: error.message }
    // 'already_*' means a concurrent path (webhook, admin) settled it first.
    if (data !== 'ok') return { outcome: 'waiting', detail: data }
    return { outcome: 'refunded' }
  }

  if (decision.action === 'complete') {
    const { data: flipped } = await supabase
      .from('withdrawal_requests')
      .update({ status: 'completed' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
    // Nothing flipped: the webhook (or an admin) settled it first, so the caller must not
    // act on it a second time (e.g. record trust twice).
    if (!flipped || flipped.length === 0) return { outcome: 'waiting', detail: 'already settled' }
    return { outcome: 'completed' }
  }

  return { outcome: 'waiting', detail: decision.message }
}
