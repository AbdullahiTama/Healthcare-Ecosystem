// Recovery for business withdrawals whose Paystack transfer did not settle cleanly.
// Twin of apps/carefind/api/_lib/withdrawalAdmin.js + withdrawalRecovery.js - the two apps
// deploy separately and each carries its own _lib, so this is a deliberate copy.
//
// initiate-business-withdrawal.js reserves the business's AVAILABLE balance
// (request_business_withdrawal) and only then calls Paystack. If that call fails, the money
// is held but nothing moved. Refunding is only safe once Paystack confirms the transfer will
// not happen: a timeout can mean the transfer was created anyway, and refunding then pays the
// business twice. So every path asks Paystack by reference first.

import { paystackFetch } from './paystack.js'

// A row with a reference but no transfer code is either a crash before the code was saved or
// a transfer call still in flight. Give it this long before an unverifiable "not found" is
// believed.
export const IN_FLIGHT_GRACE_MS = 10 * 60 * 1000

const IN_FLIGHT = new Set(['pending', 'otp', 'processing', 'queued', 'received'])
const NOT_PAID = new Set(['failed', 'reversed', 'abandoned', 'blocked', 'rejected'])

// Paystack's transfer verify accepts the transfer reference, which we always have.
export async function getTransferStatus(reference, fetcher = paystackFetch) {
  const data = await fetcher(`/transfer/verify/${encodeURIComponent(reference)}`)
  if (data && data.status) return String(data.data?.status || '').toLowerCase()
  if (/not found/i.test(data?.message || '')) return 'not_found'
  throw new Error(data?.message || 'Could not verify transfer')
}

// -> { action: 'refund' | 'complete' | 'wait', message? }
export async function decideRecovery(row, { getStatus = getTransferStatus, now = Date.now(), graceMs = IN_FLIGHT_GRACE_MS } = {}) {
  if (!row?.paystack_reference) return { action: 'wait', message: 'No transfer reference on this request.' }

  const ageMs = now - new Date(row.created_at).getTime()
  const hasCode = Boolean(row.paystack_transfer_code)
  if (!hasCode && !(ageMs >= graceMs)) {
    return { action: 'wait', message: 'Filed moments ago; its transfer may still be sending.' }
  }

  let status
  try {
    status = await getStatus(row.paystack_reference)
  } catch (err) {
    return { action: 'wait', message: `Could not confirm the transfer with Paystack (${err.message}).` }
  }

  if (status === 'success') return { action: 'complete' }
  if (IN_FLIGHT.has(status)) return { action: 'wait', message: `Transfer is still ${status} at Paystack.` }
  if (NOT_PAID.has(status)) return { action: 'refund' }
  // 'not_found' is only believable once the transfer call has had time to finish and never
  // saved a code; with a code on file Paystack must know the transfer.
  if (status === 'not_found' && !hasCode) return { action: 'refund' }
  return { action: 'wait', message: `Unrecognised Paystack transfer status "${status}".` }
}

// -> { outcome: 'refunded' | 'completed' | 'waiting', detail? }
export async function reconcileBusinessWithdrawal(supabase, row, opts = {}) {
  const decision = await decideRecovery(row, opts)

  if (decision.action === 'refund') {
    const { data, error } = await supabase.rpc('reject_business_withdrawal', { p_request_id: row.id })
    if (error) return { outcome: 'waiting', detail: error.message }
    // 'already_*' means a concurrent path (the transfer webhook) settled it first.
    if (data !== 'ok') return { outcome: 'waiting', detail: data }
    return { outcome: 'refunded' }
  }

  if (decision.action === 'complete') {
    await supabase
      .from('business_withdrawal_requests')
      .update({ status: 'completed' })
      .eq('id', row.id)
      .in('status', ['pending', 'processing'])
    return { outcome: 'completed' }
  }

  return { outcome: 'waiting', detail: decision.message }
}

// Sweep: every automated withdrawal still unsettled after the grace period.
export async function reconcileBusinessWithdrawals(supabase, { now = Date.now(), limit = 50, ...opts } = {}) {
  const cutoff = new Date(now - IN_FLIGHT_GRACE_MS).toISOString()
  const { data: rows, error } = await supabase
    .from('business_withdrawal_requests')
    .select('id, business_id, amount, status, paystack_reference, paystack_transfer_code, created_at')
    .in('status', ['pending', 'processing'])
    .not('paystack_reference', 'is', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const summary = { checked: 0, refunded: 0, completed: 0, waiting: 0, errors: 0 }
  for (const row of rows || []) {
    summary.checked++
    try {
      const result = await reconcileBusinessWithdrawal(supabase, row, { now, ...opts })
      summary[result.outcome]++
      if (result.outcome === 'refunded') {
        console.warn('[reconcile] refunded unsettled business withdrawal', { id: row.id, reference: row.paystack_reference })
      }
    } catch (err) {
      summary.errors++
      console.error('[reconcile] business withdrawal failed', { id: row.id, reference: row.paystack_reference, message: err.message })
    }
  }
  return summary
}
