import { createClient } from '@supabase/supabase-js'
import { verifyUser } from '../_lib/verifyUser.js'
import { hashPin, randomPinSalt, isValidPin } from '../_lib/pinCrypto.js'

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

// POST /api/withdrawal-pin/set     — create/replace the account owner's PIN
// POST /api/withdrawal-pin/verify  — pre-check a PIN (a future "change PIN"
//                                    flow verifies the old PIN before setting
//                                    a new one)
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

  if (!isValidPin(pin)) {
    return res.status(400).json({ error: 'Withdrawal PIN must be 4-6 digits' })
  }

  if (action === 'set') {
    // A PIN is a step-up credential, so the account must already prove it owns
    // its email before it can arm one.
    if (!user.email_confirmed_at) {
      return res.status(403).json({ error: 'Confirm your email before setting a withdrawal PIN' })
    }

    const salt = randomPinSalt()
    const hash = hashPin(pin, salt)
    const { error } = await supabase.rpc('set_withdrawal_pin', {
      p_user_id: user.id,
      p_pin_hash: hash,
      p_pin_salt: salt,
    })
    if (error) {
      return res.status(500).json({ error: 'Could not set withdrawal PIN' })
    }
    return res.status(200).json({ ok: true })
  }

  if (action === 'verify') {
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