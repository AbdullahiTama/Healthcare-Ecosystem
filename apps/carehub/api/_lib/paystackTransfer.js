// CareHub business payout helpers — Paystack transfer recipient + transfer.
// Mirrors apps/carefind/api/_lib/paystackTransfer.js, but scopes the recipient
// metadata to a business_id. The two apps are separate Vercel deployments and
// each carries its own _lib (same pattern as commissions.js vs the CareFind
// libs), so this is duplicated deliberately, not by accident.
//
// IMPORTANT: business withdrawals carry NO transfer fee. The platform's 20%
// take-rate is already deducted at booking settlement (ADR-005); the wallet
// balance is the business's net 80%.

import crypto from 'crypto'
import { paystackFetch } from './paystack.js'

// Create a Paystack transfer recipient for a business. Subsequent calls with
// the same account details return the existing recipient_code.
export async function createTransferRecipient({ bankCode, accountNumber, accountName, businessId }) {
  const data = await paystackFetch('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name: accountName,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
      metadata: { business_id: businessId },
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
      reason: reason || 'CareHub business withdrawal',
      reference,
    }),
  })

  if (!data.status) {
    throw new Error(data.message || 'Could not initiate transfer')
  }

  return { transferCode: data.data.transfer_code, reference: data.data.reference }
}

// Check Paystack balance (to verify we have enough before a transfer).
export async function checkBalance() {
  const data = await paystackFetch('/balance')
  if (!data.status) throw new Error('Could not check balance')
  const available = (data.data || []).reduce((sum, b) => sum + b.available_balance, 0)
  return available
}

// Resolve the account holder name for a bank/account-number pair via
// Paystack's /bank/resolve. Used to verify the account name before initiating
// a transfer, so a typo can't route money to the wrong account.
export async function resolveAccount({ bankCode, accountNumber }) {
  const qs = `account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  const data = await paystackFetch(`/bank/resolve?${qs}`)

  if (!data.status) {
    const err = new Error(data.message || 'Could not verify account')
    err.paystackMessage = data.message
    err.bankCode = bankCode
    err.accountNumber = accountNumber
    throw err
  }

  return { accountName: data.data.account_name, accountNumber: data.data.account_number }
}

// Generate a unique reference for a business transfer.
export function transferReference(businessId) {
  return `ch_wd_${businessId.slice(0, 8)}_${crypto.randomBytes(6).toString('hex')}`
}
