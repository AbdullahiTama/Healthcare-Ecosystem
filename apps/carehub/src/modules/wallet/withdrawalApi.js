import { authClient } from '../../lib/authClient'

// One place for the business-withdrawal request, shared by the Wallet and Appointments screens (they used to carry
// two copies of the fetch). The server decides everything that matters (the bank account name is verified, the
// reference and the limits are the database's); the client sends only what the owner typed, including the PIN.
// -> { ok, data, sessionExpired?, networkError? }
// With `payoutAccountId` the server takes the destination from the saved, verified account and ignores any bank details.
export async function startBusinessWithdrawal({ businessId, amountKobo, bankCode, bankName, accountNumber, accountName, pin, payoutAccountId }) {
  const { data: { session } } = await authClient.auth.getSession()
  if (!session) return { ok: false, sessionExpired: true, data: {} }
  try {
    const res = await fetch('/api/initiate-business-withdrawal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ business_id: businessId, amount: amountKobo, bankCode, bankName, accountNumber, accountName, pin, payoutAccountId }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  } catch {
    return { ok: false, networkError: true, data: {} }
  }
}

// Owner-facing text for a refused withdrawal. `needsPin` tells the form to open the "set your PIN" step.
export function withdrawalErrorMessage(data = {}) {
  if (data.needsPin) return 'Set a withdrawal PIN first.'
  if (data.code === 'payout_account_required') return 'Add and verify a payout account before withdrawing.'
  if (data.error === 'insufficient') return 'Not enough available balance.'
  if (data.error === 'daily_limit') return data.message || 'Daily withdrawal limit reached for this business.'
  if (data.error === 'below_minimum') return data.message || 'That is below the minimum withdrawal.'
  return data.error || 'Could not start withdrawal.'
}
