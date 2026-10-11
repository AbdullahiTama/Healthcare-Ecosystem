// One-time passcodes for step-up actions on money settings (setting the withdrawal PIN; adding a payout account; every withdrawal).
//
// Storage (otp_challenges, issue_otp / verify_otp - service-role only): only an HMAC of the code is stored. A 6-digit
// code has 1M possibilities, so an unkeyed hash would not survive a database leak; the keyed HMAC makes a leak
// useless without the server secret. The real brute-force defence is the 5-attempt burn and the 5-minute TTL enforced
// inside verify_otp, and the issuance ceilings enforced inside issue_otp (atomic under advisory locks): a 60 s gap and
// 3 an hour per user and purpose, plus a per-IP and a platform-wide hourly cap (financial_config).
//
// The code itself is sent by an injected `mailer` (shared-email createSecurityMailer) and is never logged, stored or
// returned to the client. Log lines carry the event, the purpose and a keyed reference to the user - never a code, an
// email address, an IP address or the secret.
import crypto from 'node:crypto'

export const OTP_TTL_SECONDS = 300
export const OTP_PURPOSES = Object.freeze({ PIN_SET: 'pin_set', PAYOUT_ACCOUNT: 'payout_account', WITHDRAWAL: 'withdrawal' })
export const OTP_PURPOSE_VALUES = Object.freeze(Object.values(OTP_PURPOSES))

/** Is this one of the purposes issue_otp / verify_otp know? (The SQL allowlist must list exactly these.) */
export const isOtpPurpose = (p) => OTP_PURPOSE_VALUES.includes(p)

/**
 * The HMAC key. Production REQUIRES its own OTP_HMAC_SECRET: reusing the service-role key as a hashing key couples the most
 * powerful credential to a stored-hash format (rotating either breaks the other). Outside production the service-role key
 * is still accepted so local runs and tests need no extra setup.
 */
function secret() {
  const dedicated = process.env.OTP_HMAC_SECRET
  if (dedicated) return dedicated
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OTP_HMAC_SECRET must be set in production (the service-role key is not accepted as an OTP hashing key)')
  }
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!fallback) throw new Error('OTP_HMAC_SECRET (or SUPABASE_SERVICE_ROLE_KEY outside production) must be set')
  return fallback
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

/** Keyed, domain-separated hash of a client address: countable per IP without ever storing the address. */
export function hashIp(ip) {
  return crypto.createHmac('sha256', secret()).update(`ip:${ip}`).digest('hex')
}

/** A short keyed reference to a user for log lines (stable, not reversible, not an identifier anyone else can use). */
function userRef(userId) {
  return crypto.createHmac('sha256', secret()).update(`uid:${userId}`).digest('hex').slice(0, 12)
}

/**
 * The client address as the platform edge reports it. Vercel overwrites these headers, so the first value of each is the
 * connecting client; a browser-supplied X-Forwarded-For is only ever a LATER entry. Returns null when none is usable
 * (the per-user and platform limits still apply).
 */
export function clientIp(req) {
  const h = req?.headers || {}
  for (const name of ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for']) {
    const raw = Array.isArray(h[name]) ? h[name][0] : h[name]
    const first = String(raw || '').split(',')[0].trim()
    if (first && first.length <= 64) return first
  }
  return null
}

export function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@')
  if (!domain) return ''
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`
}

const defaultLogger = {
  info: (event, fields) => console.info(JSON.stringify({ event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ event, ...fields })),
}

const unavailable = { status: 503, body: { error: 'Verification codes are temporarily unavailable. Try again shortly.', code: 'otp_unavailable' } }

/**
 * Issue a code and email it. -> { status, body } for the HTTP layer to relay (never contains the code).
 * @param {{ sendOtp: Function }} mailer
 * @param {string|null} [ip]  the client address (see clientIp); only its keyed hash is stored
 */
export async function sendOtp({ supabase, user, purpose, mailer, ip = null, logger = defaultLogger }) {
  if (!isOtpPurpose(purpose)) return { status: 400, body: { error: 'Unknown code purpose', code: 'otp_purpose' } }
  if (!user?.email) return { status: 400, body: { error: 'Your account has no email address to send a code to' } }
  if (!user.email_confirmed_at) return { status: 403, body: { error: 'Confirm your email before requesting a verification code' } }

  let codeHash, ipHash, ref
  const code = generateOtp()
  try {
    codeHash = hashOtp(code, user.id, purpose)
    ipHash = ip ? hashIp(ip) : null
    ref = userRef(user.id)
  } catch (err) {
    logger.error('otp.misconfigured', { purpose, reason: String(err.message).split(' (')[0] })
    return unavailable
  }

  const { data: issued, error } = await supabase.rpc('issue_otp', {
    p_user_id: user.id,
    p_purpose: purpose,
    p_code_hash: codeHash,
    p_ttl_seconds: OTP_TTL_SECONDS,
    p_ip_hash: ipHash,
  })
  if (error) {
    logger.error('otp.issue_failed', { purpose, user: ref })
    return { status: 500, body: { error: 'Could not create a verification code' } }
  }
  if (issued === 'cooldown') return { status: 429, body: { error: 'Please wait a minute before requesting another code.', code: 'otp_cooldown' } }
  if (issued === 'rate_limited' || issued === 'ip_limited') {
    logger.warn('otp.rate_limited', { purpose, user: ref, scope: issued === 'ip_limited' ? 'ip' : 'user' })
    return { status: 429, body: { error: 'Too many codes requested. Try again in an hour.', code: 'otp_rate_limited' } }
  }
  if (issued === 'global_limited') {
    logger.warn('otp.rate_limited', { purpose, user: ref, scope: 'global' })
    return unavailable
  }
  if (issued !== 'ok') {
    logger.error('otp.issue_unexpected', { purpose, user: ref })
    return { status: 500, body: { error: 'Could not create a verification code' } }
  }

  const sent = await mailer.sendOtp({ to: user.email, code, minutes: OTP_TTL_SECONDS / 60, purpose })
  if (!sent.ok) {
    // The code row stays (it expires on its own); the reason is logged without the recipient or the code.
    logger.error('otp.delivery_failed', { purpose, user: ref, reason: String(sent.error || 'send_failed').replace(/\S+@\S+/g, '[email]').slice(0, 80) })
    return { status: 502, body: { error: 'Could not send the verification email. Try again shortly.' } }
  }

  logger.info('otp.issued', { purpose, user: ref })
  return { status: 200, body: { ok: true, sentTo: maskEmail(user.email), expiresInSeconds: OTP_TTL_SECONDS } }
}

/**
 * The shared HTTP action behind `/api/<route>/otp` in both apps: validates the requested purpose against what that route
 * may issue, then issues. Keeping it here means CareFind and CareHub cannot drift apart.
 * @param {{ headers?: object, body?: { purpose?: string } }} req
 * @param {string[]} [allowed]   purposes this route may mint (anything else is refused)
 * @param {string}   [fallback]  purpose when the request names none
 */
export async function issueOtpFromRequest({ supabase, user, req, mailer, allowed = [OTP_PURPOSES.PIN_SET, OTP_PURPOSES.WITHDRAWAL], fallback = OTP_PURPOSES.PIN_SET, logger }) {
  const wanted = (req?.body || {}).purpose
  if (wanted !== undefined && !allowed.includes(wanted)) return { status: 400, body: { error: 'Unknown code purpose' } }
  return sendOtp({ supabase, user, purpose: wanted || fallback, mailer, ip: clientIp(req), logger })
}

const VERIFY_FAILURES = {
  invalid: { status: 400, code: 'otp_invalid', error: 'Incorrect code. Check the email and try again.' },
  expired: { status: 400, code: 'otp_expired', error: 'That code has expired. Request a new one.' },
  locked: { status: 429, code: 'otp_locked', error: 'Too many wrong codes. Request a new one.' },
  none: { status: 400, code: 'otp_missing', error: 'Request a verification code first.' },
}

/** Verify and consume the code (single use). -> { ok: true } | { ok: false, status, code, error } */
export async function checkOtp({ supabase, userId, purpose, code, logger = defaultLogger }) {
  if (!isValidOtp(code)) return { ok: false, status: 400, code: 'otp_invalid', error: 'Enter the 6-digit code we emailed you.' }
  if (!isOtpPurpose(purpose)) return { ok: false, status: 400, code: 'otp_purpose', error: 'Unknown code purpose' }

  let hash, ref
  try {
    hash = hashOtp(code, userId, purpose)
    ref = userRef(userId)
  } catch (err) {
    logger.error('otp.misconfigured', { purpose, reason: String(err.message).split(' (')[0] })
    return { ok: false, status: 503, code: 'otp_unavailable', error: 'Could not verify the code' }
  }

  const { data: result, error } = await supabase.rpc('verify_otp', { p_user_id: userId, p_purpose: purpose, p_code_hash: hash })
  if (error) {
    logger.error('otp.verify_failed_rpc', { purpose, user: ref })
    return { ok: false, status: 500, code: 'otp_unavailable', error: 'Could not verify the code' }
  }
  if (result === 'ok') return { ok: true }
  // Only the outcome is logged: a wrong guess is the signal worth alerting on, the guess itself must never be kept.
  logger.warn('otp.verify_rejected', { purpose, user: ref, result: String(result) })
  return { ok: false, ...(VERIFY_FAILURES[result] || { status: 500, code: 'otp_unavailable', error: 'Could not verify the code' }) }
}

/**
 * Delete codes that can no longer matter (default: older than a day). Run by the scheduled step `otp_purge`, not from the
 * request path. -> { purged }
 */
export async function purgeOtpChallenges(supabase, { olderThanMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  const cutoff = new Date(now - olderThanMs).toISOString()
  const { error, count } = await supabase.from('otp_challenges').delete({ count: 'exact' }).lt('created_at', cutoff)
  if (error) throw new Error(`otp purge failed: ${error.message}`)
  return { purged: count ?? 0 }
}
