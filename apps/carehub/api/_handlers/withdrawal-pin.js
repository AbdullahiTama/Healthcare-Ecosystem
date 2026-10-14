import { issueOtpFromRequest, setWithdrawalPin, withdrawalPinStatus, createWithdrawalDraft, getWithdrawalDraft, voidWithdrawalDraft } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { getSecurityMailer } from '../_lib/securityMailer.js'

// The router folds every /api/<route> into one catch-all and dispatches on the FIRST path segment, so this
// handler resolves the second segment itself.
function subPath(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  return segments[1] || ''
}

// POST /api/withdrawal-pin/status  - { hasPin }
// POST /api/withdrawal-pin/otp     - email a 6-digit code to the owner (needed to set or replace the PIN)
// POST /api/withdrawal-pin/set     - { pin, otp, currentPin? | forgot: true } create the owner's PIN, or replace it
//
// The PIN is the second factor against a stolen owner session (audit F-08): without it, a session alone cannot move
// the wallet to a bank account. So setting or replacing one needs (1) a fresh emailed code - otherwise a thief would
// just set their own PIN first - and (2) when REPLACING, the current PIN, unless the owner chose "forgot PIN" (then the
// code is the only proof). The raw PIN travels only over HTTPS and is never logged or stored: the database sees only
// the scrypt hash. Rules live in @care-ecosystem/shared-payments, shared with CareFind (one PIN per person).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const action = subPath(req)

  if (action === 'status') {
    const r = await withdrawalPinStatus(supabase, user.id)
    return res.status(r.status).json(r.body)
  }

  if (action === 'otp') {
    // Two things need a code here: arming the PIN (default) and confirming a withdrawal ({ purpose: 'withdrawal' }).
    // Anything else is refused by the shared helper, so this endpoint cannot mint codes for other purposes.
    if (((req.body || {}).purpose || 'pin_set') === 'withdrawal') {
      // The code is issued for THIS request: the server owns the amount and
      // destination in a draft first, so a resumed form cannot be repurposed
      // (Phase 1). A code already on its way is not re-issued unless the owner
      // explicitly asks again (reissue:true voids the prior draft first; the
      // issue_otp 60 s cooldown still applies to the new code).
      const { amount, payoutAccountId, bankCode, accountNumber, reissue } = req.body || {}
      const amountKobo = Number(amount)
      if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
        return res.status(400).json({ error: 'Enter an amount first.', code: 'draft_amount' })
      }
      if (!payoutAccountId && (!bankCode || !/^\d{10}$/.test(String(accountNumber || '')))) {
        return res.status(400).json({ error: 'Choose a payout destination first.', code: 'draft_destination' })
      }
      const destination = { savedId: payoutAccountId, bankCode, accountNumber }
      const draftUnavailable = () => res.status(503).json({ error: 'Withdrawals are temporarily unavailable. Try again shortly.', code: 'draft_unavailable' })
      let draft
      try {
        draft = await createWithdrawalDraft(supabase, { userId: user.id, app: 'carehub', amount: amountKobo, unit: 'kobo', destination })
      } catch (err) {
        return draftUnavailable()
      }
      if (draft.ok === false && draft.outcome === 'draft_active') {
        if (reissue !== true) {
          return res.status(409).json({ error: 'A code is already on its way — check your email.', code: 'draft_active' })
        }
        // Reissue issues the new code FIRST: a 60 s-cooldown 429 returns untouched and the live draft survives.
        // Only once the code is sent is the prior draft voided and the new one owned.
        const reissued = await issueOtpFromRequest({ supabase, user, req, mailer: await getSecurityMailer() })
        if (reissued.status !== 200) return res.status(reissued.status).json(reissued.body)
        try {
          await voidWithdrawalDraft(supabase, { userId: user.id, reason: 'reissue' })
        } catch (err) {
          return draftUnavailable()
        }
        console.info(JSON.stringify({ event: 'draft.voided', purpose: 'withdrawal', reason: 'reissue' }))
        try {
          draft = await createWithdrawalDraft(supabase, { userId: user.id, app: 'carehub', amount: amountKobo, unit: 'kobo', destination })
        } catch (err) {
          console.info(JSON.stringify({ event: 'draft.reissue_failed', purpose: 'withdrawal', reason: 'create_failed' }))
          return res.status(500).json({ error: 'Could not create a verification code' })
        }
        if (draft.ok === false && draft.outcome === 'draft_active') {
          return res.status(409).json({ error: 'A code is already on its way — check your email.', code: 'draft_active' })
        }
        return res.status(reissued.status).json(reissued.body)
      }
      const r = await issueOtpFromRequest({ supabase, user, req, mailer: await getSecurityMailer() })
      if (r.status !== 200) {
        // No phantom lock: a draft created for a code that never went out is voided (best-effort).
        try {
          await voidWithdrawalDraft(supabase, { userId: user.id, reason: 'issue_failed' })
          console.info(JSON.stringify({ event: 'draft.voided', purpose: 'withdrawal', reason: 'issue_failed' }))
        } catch (err) {
          // Best-effort: the draft expires in 10 min anyway; the send failure below is the response.
        }
      }
      return res.status(r.status).json(r.body)
    }
    const r = await issueOtpFromRequest({ supabase, user, req, mailer: await getSecurityMailer() })
    return res.status(r.status).json(r.body)
  }

  if (action === 'draft') {
    const draft = await getWithdrawalDraft(supabase, { userId: user.id })
    if (!draft) return res.status(200).json({ draft })
    // The fingerprint is server-side HMAC material for the submit gate — never send it to the client.
    const { destination_fp: _fp, ...safe } = draft
    return res.status(200).json({ draft: safe })
  }

  if (action === 'set') {
    const { pin, otp, currentPin, forgot } = req.body || {}
    const r = await setWithdrawalPin(supabase, user, { pin, otp, currentPin, forgot: forgot === true, mailer: await getSecurityMailer() })
    return res.status(r.status).json(r.body)
  }

  return res.status(404).json({ error: 'Unknown withdrawal PIN action' })
}
