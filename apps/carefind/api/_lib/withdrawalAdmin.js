// Decides what an admin approve/reject on a withdrawal request is allowed to do.
//
// Withdrawals created by initiate-withdrawal.js are paid out automatically: the
// Paystack transfer is created in the same request that files the row, and the row
// stays `pending` until Paystack's webhook settles it. An admin acting on such a row
// races a transfer that may already be paying the user's bank account:
//   * rejecting refunds the coins while Paystack still pays -> double payout
//   * approving moves the row to `approved`, which the completion webhook ignores
// So for automated rows the admin's reject is only allowed once Paystack itself says
// the transfer did not (and will not) happen, and approve is not a thing at all.
// Legacy rows (no paystack_reference) are manual and keep the old behaviour.

import { paystackFetch } from './paystack.js'

// A row with a reference but no transfer code is either a crash before the code was
// saved or a transfer call still in flight. Give a request this long to resolve
// before an unverifiable "not found" is believed.
export const IN_FLIGHT_GRACE_MS = 10 * 60 * 1000

const IN_FLIGHT = new Set(['pending', 'otp', 'processing', 'queued', 'received'])
const NOT_PAID = new Set(['failed', 'reversed', 'abandoned', 'blocked', 'rejected'])

// Paystack's transfer verify accepts the transfer reference, which we always have
// (the transfer code is only saved after the transfer call returns).
export async function getTransferStatus(reference, fetcher = paystackFetch) {
  const data = await fetcher(`/transfer/verify/${encodeURIComponent(reference)}`)
  if (data && data.status) return String(data.data?.status || '').toLowerCase()
  if (/not found/i.test(data?.message || '')) return 'not_found'
  throw new Error(data?.message || 'Could not verify transfer')
}

export function decideAdminApprove(row) {
  if (row?.paystack_reference) {
    return {
      action: 'block',
      message: 'This withdrawal is paid out automatically by Paystack, so there is nothing to approve.',
    }
  }
  return { action: 'approve' }
}

// -> { action: 'refund' | 'complete' | 'block', message? }
export async function decideAdminReject(row, { getStatus = getTransferStatus, now = Date.now(), graceMs = IN_FLIGHT_GRACE_MS } = {}) {
  if (!row?.paystack_reference) return { action: 'refund' }

  const ageMs = now - new Date(row.created_at).getTime()
  const hasCode = Boolean(row.paystack_transfer_code)
  if (!hasCode && !(ageMs >= graceMs)) {
    return {
      action: 'block',
      message: 'This withdrawal was filed moments ago and its transfer may still be sending. Try again in a few minutes.',
    }
  }

  let status
  try {
    status = await getStatus(row.paystack_reference)
  } catch (err) {
    return {
      action: 'block',
      message: `Could not confirm the transfer with Paystack (${err.message}). Nothing was refunded.`,
    }
  }

  if (status === 'success') {
    return {
      action: 'complete',
      message: 'The transfer already succeeded at Paystack, so it was marked completed instead of refunded.',
    }
  }
  if (IN_FLIGHT.has(status)) {
    return { action: 'block', message: `The transfer is still ${status} at Paystack. Wait for it to settle before rejecting.` }
  }
  if (NOT_PAID.has(status)) return { action: 'refund' }
  // 'not_found' is only believable once the transfer call has had time to finish and
  // never saved a code; with a code on file Paystack must know the transfer.
  if (status === 'not_found' && !hasCode) return { action: 'refund' }

  return { action: 'block', message: `Unrecognised Paystack transfer status "${status}". Nothing was refunded.` }
}
