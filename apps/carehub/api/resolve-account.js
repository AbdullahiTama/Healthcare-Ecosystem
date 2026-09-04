import { resolveAccount } from './_lib/paystackTransfer.js'

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

  const acct = String(accountNumber).trim()
  if (!/^\d{10}$/.test(acct)) {
    return res.status(400).json({ error: 'Account number must be exactly 10 digits' })
  }

  try {
    const result = await resolveAccount({ bankCode: String(bankCode).trim(), accountNumber: acct })
    return res.status(200).json({ accountName: result.accountName })
  } catch (err) {
    console.error('[resolve-account] Failed:', err.message, '| bankCode:', bankCode, '| accountNumber:', acct)
    return res.status(400).json({
      error: 'Could not verify account. Check that the bank and account number are correct.',
      detail: err.message || String(err),
    })
  }
}
