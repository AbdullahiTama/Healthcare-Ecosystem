import { resolveAccount } from '../_lib/paystackTransfer.js'

// POST /api/resolve-account
// Resolves a bank account name from bank code + account number via Paystack.
// Used by the withdrawal form to auto-populate the account name field.
export default async function resolveAccountHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { bankCode, accountNumber } = req.body || {}

  if (!bankCode || !accountNumber) {
    return res.status(400).json({ error: 'Bank code and account number are required' })
  }

  if (!/^\d{10}$/.test(accountNumber)) {
    return res.status(400).json({ error: 'Account number must be 10 digits' })
  }

  try {
    const result = await resolveAccount({ bankCode, accountNumber })
    return res.status(200).json({ accountName: result.accountName })
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not resolve account name' })
  }
}
