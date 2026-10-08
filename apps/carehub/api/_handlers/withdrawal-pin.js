import { hashPin, randomPinSalt, isValidPin, checkWithdrawalPin } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { verifyWithdrawalOtp } from '../_lib/emailOtp.js'

// The router folds every /api/<route> into one catch-all and dispatches on the FIRST path segment, so this
// handler resolves the second segment itself.
function subPath(req) {
  const pathname = (req.url || '').split('?')[0].replace(/\/+$/, '')
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  return segments[1] || ''
}

// POST /api/withdrawal-pin/status  - { hasPin }
// POST /api/withdrawal-pin/set     - { pin, currentPin? } create the owner's PIN, or replace it
//
// The PIN is the second factor against a stolen owner session (audit F-08): without it, a session alone cannot
// move the wallet to a bank account. So REPLACING a PIN requires the current PIN - otherwise a thief would simply
// set their own and withdraw. (There is no "forgot PIN" flow yet; that needs an emailed one-time code and is a
// product decision.) The raw PIN travels only over HTTPS and is never logged or stored: this derives
// scrypt(pin, salt) and the database sees only the hash.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authError } = await verifyBusiness(supabase, req)
  if (authError) return res.status(401).json({ error: authError })

  const action = subPath(req)

  const { data: rows, error: readError } = await supabase.rpc('get_withdrawal_pin', { p_user_id: user.id })
  if (readError) return res.status(500).json({ error: 'Could not read your withdrawal PIN settings' })
  const stored = Array.isArray(rows) ? rows[0] : rows
  const hasPin = Boolean(stored?.pin_hash)

  if (action === 'status') return res.status(200).json({ hasPin })

  if (action === 'set') {
    const { pin, currentPin, otp } = req.body || {}
    if (!isValidPin(pin)) return res.status(400).json({ error: 'Withdrawal PIN must be 4-6 digits' })

    // A PIN is a step-up credential, so the account must already prove it owns its email before it can arm one.
    if (!user.email_confirmed_at) return res.status(403).json({ error: 'Confirm your email before setting a withdrawal PIN' })

    // Every arm/replace requires a fresh email OTP.
    const otpCheck = await verifyWithdrawalOtp(supabase, user.id, otp)
    if (otpCheck.error) return res.status(otpCheck.status).json({ error: otpCheck.error })

    if (hasPin) {
      const check = await checkWithdrawalPin(supabase, user.id, currentPin)
      if (!check.ok) {
        return res.status(check.status).json({ error: check.code === 'invalid_pin' ? 'Enter your current withdrawal PIN to change it' : check.error, code: check.code })
      }
    }

    const salt = randomPinSalt()
    const { error } = await supabase.rpc('set_withdrawal_pin', { p_user_id: user.id, p_pin_hash: hashPin(pin, salt), p_pin_salt: salt })
    if (error) return res.status(500).json({ error: 'Could not set withdrawal PIN' })
    return res.status(200).json({ ok: true })
  }

  return res.status(404).json({ error: 'Unknown withdrawal PIN action' })
}
