// One-time passcodes for step-up actions on money settings (setting the withdrawal PIN; adding a payout account; every withdrawal).
//
// Storage (otp_challenges, issue_otp / verify_otp - service-role only): only an HMAC of the code is stored. A 6-digit
// code has 1M possibilities, so an unkeyed hash would not survive a database leak; the keyed HMAC makes a leak
// useless without the server secret. The real brute-force defence is the 5-attempt burn and the 5-minute TTL enforced
// inside verify_otp, and the 60 s resend gap / 3 per hour cap enforced inside issue_otp (atomic under an advisory lock).
//
// The code itself is sent by an injected `mailer` (shared-email createSecurityMailer) and is never logged, stored or
// returned to the client.
import crypto from 'node:crypto'

export const OTP_TTL_SECONDS = 300
export const OTP_PURPOSES = Object.freeze({ PIN_SET: 'pin_set', PAYOUT_ACCOUNT: 'payout_account', WITHDRAWAL: 'withdrawal' })

function secret() {
  const s = process.env.OTP_HMAC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('OTP_HMAC_SECRET (or SUPABASE_SERVICE_ROLE_KEY) must be set')
  return s
}

/** Uniform 6-digit code from a CSPRNG (randomInt avoids modulo bias). */
export function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0')
}

export function isValidOtp(code) {
  return typeof code === 'string' && /^\d{6}$/.test(code)
}

/** Bound to user and purpose: a code issued for one action cannot be replayed for another, or by another account. */
export function hashOtp(code, userId, purpose) {
  return crypto.createHmac('sha256', secret()).update(`${userId}:${purpose}:${code}`).digest('hex')
}

export function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@')
  if (!domain) return ''
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`
}

/**
 * Issue a code and email it. -> { status, body } for the HTTP layer to relay (never contains the code).
 * @param {{ sendOtp: Function }} mailer
 */
export async function sendOtp({ supabase, user, purpose, mailer }) {
  if (!user?.email) return { status: 400, body: { error: 'Your account has no email address to send a code to' } }
  if (!user.email_confirmed_at) return { status: 403, body: { error: 'Confirm your email before requesting a verification code' } }

  const code = generateOtp()
  const { data: issued, error } = await supabase.rpc('issue_otp', {
    p_user_id: user.id,
    p_purpose: purpose,
    p_code_hash: hashOtp(code, user.id, purpose),
    p_ttl_seconds: OTP_TTL_SECONDS,
  })
  if (error) return { status: 500, body: { error: 'Could not create a verification code' } }
  if (issued === 'cooldown') return { status: 429, body: { error: 'Please wait a minute before requesting another code.', code: 'otp_cooldown' } }
  if (issued === 'rate_limited') return { status: 429, body: { error: 'Too many codes requested. Try again in an hour.', code: 'otp_rate_limited' } }
  if (issued !== 'ok') return { status: 500, body: { error: 'Could not create a verification code' } }

  const sent = await mailer.sendOtp({ to: user.email, code, minutes: OTP_TTL_SECONDS / 60, purpose })
  if (!sent.ok) {
    console.error('[otp] email delivery failed:', sent.error)
    return { status: 502, body: { error: 'Could not send the verification email. Try again shortly.' } }
  }

  // Housekeeping, best effort: codes older than a day are useless. Failure must not affect the user.
  try {
    Promise.resolve(supabase.from('otp_challenges').delete().lt('created_at', new Date(Date.now() - 86400000).toISOString())).catch(() => {})
  } catch { /* housekeeping only */ }

  return { status: 200, body: { ok: true, sentTo: maskEmail(user.email), expiresInSeconds: OTP_TTL_SECONDS } }
}

const VERIFY_FAILURES = {
  invalid: { status: 400, code: 'otp_invalid', error: 'Incorrect code. Check the email and try again.' },
  expired: { status: 400, code: 'otp_expired', error: 'That code has expired. Request a new one.' },
  locked: { status: 429, code: 'otp_locked', error: 'Too many wrong codes. Request a new one.' },
  none: { status: 400, code: 'otp_missing', error: 'Request a verification code first.' },
}

/** Verify and consume the code (single use). -> { ok: true } | { ok: false, status, code, error } */
export async function checkOtp({ supabase, userId, purpose, code }) {
  if (!isValidOtp(code)) return { ok: false, status: 400, code: 'otp_invalid', error: 'Enter the 6-digit code we emailed you.' }
  const { data: result, error } = await supabase.rpc('verify_otp', {
    p_user_id: userId, p_purpose: purpose, p_code_hash: hashOtp(code, userId, purpose),
  })
  if (error) return { ok: false, status: 500, code: 'otp_unavailable', error: 'Could not verify the code' }
  if (result === 'ok') return { ok: true }
  return { ok: false, ...(VERIFY_FAILURES[result] || { status: 500, code: 'otp_unavailable', error: 'Could not verify the code' }) }
}
