import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { resolveAccount } from '../_lib/paystackTransfer.js'
import { verifyBankAccount, checkWithdrawalPin } from '@care-ecosystem/shared-payments'
import { verifyWithdrawalOtp } from '../_lib/emailOtp.js'

function subPath(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  return segments[1] || ''
}

const BVN_NIN = /^\d{11}$/

// GET  /api/payout-accounts            - list the verified business's saved accounts
// POST /api/payout-accounts            - add a new account (bank-name-verified, pending_review)
// POST /api/payout-accounts/set-default - mark a VERIFIED account as default (needs PIN + fresh email OTP)
// POST /api/payout-accounts/edit       - change bank/account details (re-resolved; back to pending_review, default cleared)
// POST /api/payout-accounts/remove     - remove a non-default account
export default async function handler(req, res) {
  const { business, user, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const action = subPath(req)

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('payout_accounts')
      .select('id, bank_code, bank_name, account_number, account_name, status, is_default, bvn_last4, nin_last4, verified_at, created_at')
      .eq('owner_business_id', business.id)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: 'Could not load saved accounts' })
    return res.status(200).json({ accounts: data || [] })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (action === '' || action === 'add') {
    const { bankCode, bankName, accountNumber, accountName, bvn, nin } = req.body || {}
    if (!bankCode || !bankName || !accountNumber || !accountName) {
      return res.status(400).json({ error: 'Bank, account number and account name are required' })
    }
    if (!/^\d{10}$/.test(String(accountNumber))) return res.status(400).json({ error: 'Account number must be 10 digits' })
    if (bvn && !BVN_NIN.test(String(bvn))) return res.status(400).json({ error: 'BVN must be 11 digits' })
    if (nin && !BVN_NIN.test(String(nin))) return res.status(400).json({ error: 'NIN must be 11 digits' })

    const account = await verifyBankAccount(resolveAccount, { bankCode: String(bankCode).trim(), accountNumber: String(accountNumber).trim(), accountName })
    if (!account.ok) return res.status(account.status).json({ error: account.error })

    const { data: row, error } = await supabase
      .from('payout_accounts')
      .insert({
        owner_business_id: business.id,
        bank_code: bankCode,
        bank_name: bankName,
        account_number: String(accountNumber),
        account_name: account.accountName,
        status: 'pending_review',
        bvn_last4: bvn ? String(bvn).slice(-4) : null,
        nin_last4: nin ? String(nin).slice(-4) : null,
      })
      .select()
      .single()
    if (error) return res.status(500).json({ error: 'Could not save the account' })

    await supabase.from('payout_account_events').insert({ payout_account_id: row.id, actor: user.id, action: 'added' })
    return res.status(200).json({ account: row })
  }

  if (action === 'set-default') {
    const { id, pin, otp } = req.body || {}
    if (!id) return res.status(400).json({ error: 'Missing account id' })

    const { data: rows } = await supabase.from('payout_accounts').select('id, status, owner_business_id').eq('id', id).single()
    if (!rows || rows.owner_business_id !== business.id) return res.status(404).json({ error: 'Account not found' })
    if (rows.status !== 'verified') return res.status(400).json({ error: 'The account must be verified before it can be the default' })

    // Step-up: current PIN + a fresh email OTP.
    const pinCheck = await checkWithdrawalPin(supabase, user.id, pin)
    if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error })

    const otpCheck = await verifyWithdrawalOtp(supabase, user.id, otp)
    if (otpCheck.error) return res.status(otpCheck.status).json({ error: otpCheck.error })

    await supabase.from('payout_accounts').update({ is_default: false }).eq('owner_business_id', business.id).eq('is_default', true)
    await supabase.from('payout_accounts').update({ is_default: true }).eq('id', id)
    await supabase.from('payout_account_events').insert({ payout_account_id: id, actor: user.id, action: 'set_default' })
    return res.status(200).json({ ok: true })
  }

  if (action === 'edit') {
    const { id, bankCode, bankName, accountNumber, accountName, bvn, nin } = req.body || {}
    if (!id) return res.status(400).json({ error: 'Missing account id' })
    if (!bankCode || !bankName || !accountNumber || !accountName) {
      return res.status(400).json({ error: 'Bank, account number and account name are required' })
    }
    if (!/^\d{10}$/.test(String(accountNumber))) return res.status(400).json({ error: 'Account number must be 10 digits' })
    if (bvn && !BVN_NIN.test(String(bvn))) return res.status(400).json({ error: 'BVN must be 11 digits' })
    if (nin && !BVN_NIN.test(String(nin))) return res.status(400).json({ error: 'NIN must be 11 digits' })

    const { data: rows } = await supabase.from('payout_accounts').select('id, owner_business_id, account_number, bank_code').eq('id', id).single()
    if (!rows || rows.owner_business_id !== business.id) return res.status(404).json({ error: 'Account not found' })

    // Same bank-side name check as add: the typed name must match the new account number.
    const account = await verifyBankAccount(resolveAccount, { bankCode: String(bankCode).trim(), accountNumber: String(accountNumber).trim(), accountName })
    if (!account.ok) return res.status(account.status).json({ error: account.error })

    // Audit first: the previous details are snapshotted before the row changes.
    await supabase.from('payout_account_events').insert({
      payout_account_id: rows.id,
      actor: user.id,
      action: 'edited',
      meta: { account_number: rows.account_number || null, bank_code: rows.bank_code || null, owner_business_id: rows.owner_business_id },
    })
    // An edited account must be reviewed again; a former default loses that status so
    // "default implies verified" cannot silently break (plan A7).
    const { data: updated, error } = await supabase
      .from('payout_accounts')
      .update({
        bank_code: bankCode,
        bank_name: bankName,
        account_number: String(accountNumber),
        account_name: account.accountName,
        status: 'pending_review',
        verified_at: null,
        is_default: false,
        bvn_last4: bvn ? String(bvn).slice(-4) : null,
        nin_last4: nin ? String(nin).slice(-4) : null,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: 'Could not update the account' })
    return res.status(200).json({ account: updated })
  }

  if (action === 'remove') {
    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'Missing account id' })
    const { data: rows } = await supabase.from('payout_accounts').select('id, is_default, owner_business_id, account_number, bank_code').eq('id', id).single()
    if (!rows || rows.owner_business_id !== business.id) return res.status(404).json({ error: 'Account not found' })
    if (rows.is_default) return res.status(400).json({ error: 'Remove is not allowed on the default account; set another default first' })
    await supabase.from('payout_account_events').insert({
      payout_account_id: rows.id,
      actor: user.id,
      action: 'removed',
      meta: { account_number: rows.account_number || null, bank_code: rows.bank_code || null, owner_business_id: rows.owner_business_id },
    })
    await supabase.from('payout_accounts').delete().eq('id', id)
    return res.status(200).json({ ok: true })
  }

  return res.status(404).json({ error: 'Unknown payout-accounts action' })
}
