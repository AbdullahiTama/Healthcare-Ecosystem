// Decides what an admin approve/reject on a withdrawal request is allowed to do.
//
// Withdrawals created by initiate-withdrawal.js are paid out automatically: the Paystack transfer is created in
// the same request that reserves the coins, and the row is settled by Paystack's webhook (or the sweep). An admin
// acting on such a row races a transfer that may already be paying the user's bank account, so reject is only
// allowed once Paystack itself says the transfer did not (and will not) happen, and approve is not a thing at all.
// Legacy rows (no paystack_reference) are manual: reject refunds them. The decision logic is shared with the
// sweep (shared-payments decideTransferAction); the refund itself is the database's settle_withdrawal().
import { decideTransferAction, getTransferStatus as sharedGetTransferStatus, IN_FLIGHT_GRACE_MS } from '@care-ecosystem/shared-payments'
import { paystackFetch } from './paystack.js'

export { IN_FLIGHT_GRACE_MS }

export const getTransferStatus = (reference, fetcher = paystackFetch) => sharedGetTransferStatus(reference, fetcher)

export function decideAdminApprove(row) {
  if (row?.paystack_reference) {
    return { action: 'block', message: 'This withdrawal is paid out automatically by Paystack, so there is nothing to approve.' }
  }
  return { action: 'block', message: 'Withdrawals are settled automatically; there is nothing to approve.' }
}

// -> { action: 'refund' | 'complete' | 'block', message? }
export async function decideAdminReject(row, { getStatus = getTransferStatus, ...opts } = {}) {
  const d = await decideTransferAction(row, { getStatus, referenceless: 'refund', ...opts })
  return d.action === 'wait' ? { action: 'block', message: d.message } : d
}
