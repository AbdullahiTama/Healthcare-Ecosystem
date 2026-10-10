import { OTP_PURPOSES, sendOtp, setWithdrawalPin, withdrawalPinStatus } from '@care-ecosystem/shared-payments'
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
    // Two things need a code: arming the PIN (default) and confirming a withdrawal ({ purpose: 'withdrawal' }). Anything
    // else is refused, so this endpoint cannot be used to mint codes for the other purposes.
    const wanted = (req.body || {}).purpose
    if (wanted !== undefined && wanted !== OTP_PURPOSES.PIN_SET && wanted !== OTP_PURPOSES.WITHDRAWAL) {
      return res.status(400).json({ error: 'Unknown code purpose' })
    }
    const r = await sendOtp({ supabase, user, purpose: wanted || OTP_PURPOSES.PIN_SET, mailer: await getSecurityMailer() })
    return res.status(r.status).json(r.body)
  }

  if (action === 'set') {
    const { pin, otp, currentPin, forgot } = req.body || {}
    const r = await setWithdrawalPin(supabase, user, { pin, otp, currentPin, forgot: forgot === true, mailer: await getSecurityMailer() })
    return res.status(r.status).json(r.body)
  }

  return res.status(404).json({ error: 'Unknown withdrawal PIN action' })
}
