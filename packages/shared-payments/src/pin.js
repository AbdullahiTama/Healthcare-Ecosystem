// Withdrawal PIN: hashing helpers and the server-side gate, shared by CareFind and CareHub (the PIN lives in
// withdrawal_pins, keyed by the Supabase auth user, so one PIN protects a person's withdrawals in both apps).
//
// The PIN is NEVER stored or logged in plaintext and the client never sees a hash or salt: it sends the raw 4-6
// digit PIN over HTTPS, this module derives scrypt(pin, salt), and the SECURITY DEFINER RPCs do the authoritative
// compare + lockout bookkeeping (5 failures lock it for 15 minutes) against those derived values.
//
// Storage format (text columns on withdrawal_pins):
//   pin_salt = 16 random bytes, hex (32 chars);  pin_hash = scrypt(pin, salt, 64 bytes), hex (128 chars)
import crypto from 'node:crypto'

const SCRYPT_KEYLEN = 64
const SALT_BYTES = 16

/** 4-6 digits, enforced client + server. */
export function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin)
}

export function randomPinSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex')
}

export function hashPin(pin, saltHex) {
  return crypto.scryptSync(pin, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN).toString('hex')
}

/** Constant-time compare so a wrong-length or wrong-value guess cannot be told apart by timing. */
export function verifyPin(pin, saltHex, expectedHash) {
  const candidate = Buffer.from(hashPin(pin, saltHex), 'hex')
  const expected = Buffer.from(expectedHash || '', 'hex')
  if (candidate.length !== expected.length) return false
  return crypto.timingSafeEqual(candidate, expected)
}

/**
 * The server-side PIN gate. -> { ok: true } | { ok: false, status, code, error, retryAfterMinutes? }
 * Never reveals a hash or salt. A wrong PIN is counted (and eventually locked) by verify_withdrawal_pin.
 * @param {object} supabase  service-role client
 * @param {string} userId    the verified auth user
 * @param {string} pin       what the client typed
 */
export async function checkWithdrawalPin(supabase, userId, pin) {
  if (!isValidPin(pin)) return { ok: false, status: 400, code: 'invalid_pin', error: 'Withdrawal PIN must be 4-6 digits' }

  const { data: rows, error: fetchError } = await supabase.rpc('get_withdrawal_pin', { p_user_id: userId })
  if (fetchError) return { ok: false, status: 500, code: 'pin_unavailable', error: 'Could not verify withdrawal PIN' }
  const stored = Array.isArray(rows) ? rows[0] : rows
  if (!stored || !stored.pin_hash) return { ok: false, status: 400, code: 'pin_not_set', error: 'Set a withdrawal PIN first' }

  if (stored.locked_until && new Date(stored.locked_until).getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((new Date(stored.locked_until).getTime() - Date.now()) / 60000))
    return { ok: false, status: 403, code: 'pin_locked', error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, retryAfterMinutes: minutes }
  }

  const attemptHash = hashPin(pin, stored.pin_salt)
  const locallyMatches = verifyPin(pin, stored.pin_salt, stored.pin_hash)
  const { data: verified, error: verifyError } = await supabase.rpc('verify_withdrawal_pin', {
    p_user_id: userId, p_pin_hash: attemptHash, p_pin_salt: stored.pin_salt,
  })
  if (verifyError || !locallyMatches || verified !== true) return { ok: false, status: 403, code: 'pin_incorrect', error: 'Incorrect withdrawal PIN.' }
  return { ok: true }
}
