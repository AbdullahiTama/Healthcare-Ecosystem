// Recovery for automated withdrawals whose Paystack transfer did not settle cleanly.
//
// initiate-withdrawal.js debits the wallet (request_withdrawal) and only then calls
// Paystack. If that call fails, the coins are gone and no money moved. Refunding is
// only safe once Paystack confirms the transfer will not happen, because a timeout
// can mean the transfer was created anyway; refunding then pays the user twice. So every
// recovery path asks Paystack by reference and applies the same decision the admin
// reject uses (decideAdminReject): success -> completed, in flight -> wait, failed or
// never created -> refund through the atomic reject_withdrawal_request RPC.

import { decideAdminReject, IN_FLIGHT_GRACE_MS } from './withdrawalAdmin.js'
import { enqueue as enqueueOutbox, processBatch as flushOutbox } from './emailService.js'

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

// Sweep: every automated withdrawal still `pending` after the grace period, checked against
// Paystack and settled one way or the other. Shared by the standalone cron/reconcile-withdrawals.js
// endpoint (for a manual/on-demand run, or a future dedicated schedule) and the chained call from
// cron/process-email-outbox.js (CareFind's actual production trigger today - see that file for why).
export async function sweepWithdrawals(supabase, { limit = 50, ...opts } = {}) {
  const cutoff = new Date(Date.now() - IN_FLIGHT_GRACE_MS).toISOString()
  const { data: rows, error } = await supabase
    .from('withdrawal_requests')
    .select('id, user_id, amount, status, paystack_reference, paystack_transfer_code, created_at')
    .eq('status', 'pending')
    .not('paystack_reference', 'is', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const summary = { checked: 0, refunded: 0, completed: 0, waiting: 0, errors: 0 }
  for (const row of rows || []) {
    summary.checked++
    try {
      const result = await reconcileWithdrawal(supabase, row, opts)
      summary[result.outcome]++
      if (result.outcome === 'refunded') {
        // Refunded because the transfer was never created or failed: no trust update - a transfer
        // that never happened is not withdrawal behaviour.
        console.warn('[reconcile-withdrawals] refunded unsettled withdrawal', { id: row.id, reference: row.paystack_reference })
        await notifyRefunded(supabase, row)
      }
      if (result.outcome === 'completed') {
        // reconcileWithdrawal only reports 'completed' when THIS call flipped the row, so the
        // webhook cannot also have recorded it.
        const { error: trustError } = await supabase.rpc('update_withdrawal_trust_after_withdrawal', {
          p_user_id: row.user_id, p_amount: row.amount, p_status: 'completed',
        })
        if (trustError) console.error('[reconcile-withdrawals] trust update failed', { id: row.id, message: trustError.message })
      }
    } catch (err) {
      summary.errors++
      console.error('[reconcile-withdrawals] row failed', { id: row.id, reference: row.paystack_reference, message: err.message })
    }
  }
  return summary
}

async function notifyRefunded(supabase, row) {
  try {
    const { data: authData } = await supabase.auth.admin.getUserById(row.user_id)
    const email = authData?.user?.email
    if (!email) return
    await enqueueOutbox({
      templateKey: 'withdrawal_failed',
      toEmail: email,
      payload: { fullName: email, amount: row.amount, reference: row.paystack_reference },
      subject: 'CareFind: withdrawal failed',
      sourceId: row.id,
      idempotencyKey: `withdrawal-failed:${row.paystack_reference}`,
    })
    flushOutbox().catch((err) => console.error('[reconcile-withdrawals] flush error:', err))
  } catch (err) {
    console.error('[reconcile-withdrawals] notify error:', err)
  }
}
