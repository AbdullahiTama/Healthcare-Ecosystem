import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { hashPin, isValidPin } from '../_lib/pinCrypto.js'
import { OTP_PURPOSES, sendOtp, setWithdrawalPin, withdrawalPinStatus } from '@care-ecosystem/shared-payments'
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