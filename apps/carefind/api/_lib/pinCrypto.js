// Withdrawal PIN hashing helpers, shared by api/_handlers/withdrawal-pin.js
// (set/verify) and api/_handlers/initiate-withdrawal.js (the withdrawal gate).
//
// The PIN is NEVER stored or logged in plaintext, and the client never sees a
// hash or salt — it only sends the raw 4-6 digit PIN over HTTPS. The API
// derives scrypt(pin, salt) here with node's built-in crypto, and the
// SECURITY DEFINER RPCs (sql/20260816_withdrawal_pin.sql) do the authoritative
// compare + lockout bookkeeping against those derived values.
//
// Storage format (text columns on withdrawal_pins):
//   pin_salt = 16 random bytes, hex-encoded (32 hex chars)
//   pin_hash = scrypt(pin, Buffer.from(salt, 'hex'), 64 bytes), hex-encoded
//              (128 hex chars)
import crypto from 'crypto'

const SCRYPT_KEYLEN = 64
const SALT_BYTES = 16

// 4-6 digits, enforced client + server.
export function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin)
}

export function randomPinSalt() {
  return crypto.randomBytes(SALT_BYTES).toString('hex')
}

export function hashPin(pin, saltHex) {
  const salt = Buffer.from(saltHex, 'hex')
  return crypto.scryptSync(pin, salt, SCRYPT_KEYLEN).toString('hex')
}

// Constant-time compare so a wrong-length or wrong-value guess can't be
// distinguished by timing.
export function verifyPin(pin, saltHex, expectedHash) {
  const candidate = Buffer.from(hashPin(pin, saltHex), 'hex')
  const expected = Buffer.from(expectedHash || '', 'hex')
  if (candidate.length !== expected.length) return false
  return crypto.timingSafeEqual(candidate, expected)
}