// Shared by initiate-withdrawal.js (called when the user submits a withdrawal)
// and paystack-transfer-webhook.js (Paystack's transfer notification). Creates
// a Paystack transfer recipient if one doesn't already exist, then initiates
// the transfer. The recipient code is cached on the withdrawal request so
// subsequent withdrawals by the same user reuse the same recipient.

import crypto from 'crypto'

const PAYSTACK_BASE = 'https://api.paystack.co'

async function paystackFetch(path, options = {}) {
  const response = await fetch(PAYSTACK_BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return response.json()
}

// Create a transfer recipient on Paystack. Returns the recipient_code.
// Subsequent calls with the same account details return the existing code.
export async function createTransferRecipient({ bankCode, accountNumber, accountName, userId }) {
  const data = await paystackFetch('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name: accountName,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
      metadata: { user_id: userId },
    }),
  })

  if (!data.status) {
    throw new Error(data.message || 'Could not create transfer recipient')
  }

  return data.data.recipient_code
}

// Initiate a transfer to an existing recipient. Returns the transfer reference.
export async function initiateTransfer({ recipientCode, amountKobo, reason, reference }) {
  const data = await paystackFetch('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: amountKobo,
      recipient: recipientCode,
      reason: reason || 'CareFind withdrawal',
      reference,
    }),
  })

  if (!data.status) {
    throw new Error(data.message || 'Could not initiate transfer')
  }

  return { transferCode: data.data.transfer_code, reference: data.data.reference }
}

// Verify the status of a transfer.
export async function verifyTransfer(transferCode) {
  const data = await paystackFetch(`/transfer/verify/${encodeURIComponent(transferCode)}`)
  if (!data.status) throw new Error(data.message || 'Could not verify transfer')
  return { status: data.data.status, recipientCode: data.data.recipient.code }
}

// Check Paystack balance (to verify we have enough before attempting a transfer).
export async function checkBalance() {
  const data = await paystackFetch('/balance')
  if (!data.status) throw new Error('Could not check balance')
  const available = (data.data || []).reduce((sum, b) => sum + b.available_balance, 0)
  return available
}

// Generate a unique reference for a transfer.
export function transferReference(userId) {
  return `cf_wd_${userId.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`
}