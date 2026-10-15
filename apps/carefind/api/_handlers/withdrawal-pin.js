import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { hashPin, isValidPin } from '../_lib/pinCrypto.js'
import { issueOtpFromRequest, setWithdrawalPin, withdrawalPinStatus, createWithdrawalDraft, getWithdrawalDraft, voidWithdrawalDraft, describeWithdrawalDraft } from '@care-ecosystem/shared-payments'
import { getSecurityMailer } from '../_lib/securityMailer.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// The router folds every /api/<route> into one catch-all and dispatches on the
// FIRST path segment, so both /api/withdrawal-pin/set and
// /api/withdrawal-pin/verify land here. This handler resolves the second
// segment itself.
function subPath(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  return segments[1] || ''
}

// A 409 has to tell the client WHEN the code already on its way was sent and WHEN that code
// dies. Without those two numbers the client had no issue time, so its resend cooldown
// rendered as 0 and "Send a new code" was live immediately — and one tap voided the code
// already sitting in the user's inbox. That is precisely how a correct code turned into
// "Incorrect code": the next submit could only answer `otp_superseded`.
async function draftActiveResponse(supabase, userId) {
  const base = { error: 'A code is already on its way — check your email.', code: 'draft_active' }
  try {
    const draft = describeWithdrawalDraft(await getWithdrawalDraft(supabase, { userId }))
    if (!draft) return { status: 409, body: base }
    const issuedAt = Date.parse(draft.otp_issued_at)
    const expiresAt = Date.parse(draft.otpExpiresAt)
    return {
      status: 409,
      body: {
        ...base,
        draftId: draft.id ?? null,
        otpIssuedAt: Number.isFinite(issuedAt) ? issuedAt : null,
        expiresInSeconds: Number.isFinite(expiresAt) ? Math.max(1, Math.round((expiresAt - Date.now()) / 1000)) : null,
        amount: draft.amount,
        unit: draft.unit,
        destinationKind: draft.destinationKind,
        savedAccountId: draft.savedAccountId,
        destinationMask: draft.destination_mask,
      },
    }
  } catch {
    // Best-effort: the plain 409 still stops the request, and the client may re-read /draft.
    return { status: 409, body: base }
  }
}

// POST /api/withdrawal-pin/status  — { hasPin }
// POST /api/withdrawal-pin/otp     — email a 6-digit code: { purpose?: 'pin_set' (default) | 'withdrawal' }
// POST /api/withdrawal-pin/set     — create/replace the PIN: { pin, otp, currentPin? | forgot: true }.
//                                    A session alone can never set it (audit F-32).
// POST /api/withdrawal-pin/verify  — pre-check a PIN
//
// The raw PIN travels from the client only over HTTPS and is never logged. It
// is never stored: the API derives scrypt(pin, salt) via pinCrypto and the
// RPCs only ever see the derived hash + salt.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const user = await verifyUser(supabase, req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const action = subPath(req)
  const { pin } = req.body || {}

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
      const coins = Number(amount)
      if (!Number.isInteger(coins) || coins < 5) {
        return res.status(400).json({ error: 'Enter an amount of at least 5 CareCoins first.', code: 'draft_amount' })
      }
      if (!payoutAccountId && (!String(bankCode || '') || !String(accountNumber || ''))) {
        return res.status(400).json({ error: 'Choose a payout destination first.', code: 'draft_destination' })
      }
      const destination = { savedId: payoutAccountId, bankCode, accountNumber }
      const draftUnavailable = () => res.status(503).json({ error: 'Withdrawals are temporarily unavailable. Try again shortly.', code: 'draft_unavailable' })
      let draft
      try {
        draft = await createWithdrawalDraft(supabase, { userId: user.id, app: 'carefind', amount: coins, unit: 'coins', destination })
      } catch (err) {
        return draftUnavailable()
      }
      if (draft.ok === false && draft.outcome === 'draft_active') {
        if (reissue !== true) {
          const busy = await draftActiveResponse(supabase, user.id)
          return res.status(busy.status).json(busy.body)
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
          draft = await createWithdrawalDraft(supabase, { userId: user.id, app: 'carefind', amount: coins, unit: 'coins', destination })
        } catch (err) {
          console.info(JSON.stringify({ event: 'draft.reissue_failed', purpose: 'withdrawal', reason: 'create_failed' }))
          return res.status(500).json({ error: 'Could not create a verification code' })
        }
        if (draft.ok === false && draft.outcome === 'draft_active') {
          const busy = await draftActiveResponse(supabase, user.id)
          return res.status(busy.status).json(busy.body)
        }
        return res.status(reissued.status).json(reissued.body)
      }
      const withdrawalCode = await issueOtpFromRequest({ supabase, user, req, mailer: await getSecurityMailer() })
      if (withdrawalCode.status !== 200) {
        // No phantom lock: a draft created for a code that never went out is voided (best-effort).
        try {
          await voidWithdrawalDraft(supabase, { userId: user.id, reason: 'issue_failed' })
          console.info(JSON.stringify({ event: 'draft.voided', purpose: 'withdrawal', reason: 'issue_failed' }))
        } catch (err) {
          // Best-effort: the draft expires in 10 min anyway; the send failure below is the response.
        }
      }
      return res.status(withdrawalCode.status).json(withdrawalCode.body)
    }
    const r = await issueOtpFromRequest({ supabase, user, req, mailer: await getSecurityMailer() })
    return res.status(r.status).json(r.body)
  }

  if (action === 'draft') {
    // Resume after a reload or a return from the mail app. The amount and the destination are
    // returned so the form can be rebuilt WITHOUT retyping, which is what stops a returning
    // user from silently invalidating the code they just read.
    const draft = describeWithdrawalDraft(await getWithdrawalDraft(supabase, { userId: user.id }))
    if (!draft) return res.status(200).json({ draft: null })
    return res.status(200).json({ draft })
  }

  if (action === 'set') {
    const { otp, currentPin, forgot } = req.body || {}
    const r = await setWithdrawalPin(supabase, user, { pin, otp, currentPin, forgot: forgot === true, mailer: await getSecurityMailer() })
    return res.status(r.status).json(r.body)
  }

  if (action === 'verify') {
    if (!isValidPin(pin)) return res.status(400).json({ error: 'Withdrawal PIN must be 4-6 digits' })
    const { data: rows, error: getError } = await supabase.rpc('get_withdrawal_pin', {
      p_user_id: user.id,
    })
    if (getError) return res.status(500).json({ error: 'Could not verify withdrawal PIN' })
    const stored = Array.isArray(rows) ? rows[0] : rows
    if (!stored || !stored.pin_hash) {
      return res.status(400).json({ error: 'Set a withdrawal PIN first' })
    }

    const { data: ok, error } = await supabase.rpc('verify_withdrawal_pin', {
      p_user_id: user.id,
      p_pin_hash: hashPin(pin, stored.pin_salt),
      p_pin_salt: stored.pin_salt,
    })
    if (error) return res.status(500).json({ error: 'Could not verify withdrawal PIN' })
    if (ok !== true) return res.status(403).json({ ok: false })
    return res.status(200).json({ ok: true })
  }

  return res.status(404).json({ error: 'Unknown withdrawal PIN action' })
}