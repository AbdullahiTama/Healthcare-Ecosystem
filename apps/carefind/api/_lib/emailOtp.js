import crypto from 'node:crypto'

// Email OTP for withdrawal-PIN step-up. The code is emailed to the confirmed
// account email; we store only a hash, burn it on first use, cap attempts, and
// rate-limit requests. Never log the code.

export const OTP_PURPOSE = 'withdrawal_pin'
export const OTP_TTL_MINUTES = 10
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_PER_HOUR = 3

export function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const hash = (code, userId) => crypto.createHash('sha256').update(`${code}:${userId}`).digest('hex')

export async function requestWithdrawalOtp(supabase, user) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabase
    .from('withdrawal_email_otps')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since)
  if (countError) return { error: 'Could not start the OTP request', status: 500 }
  if ((count ?? 0) >= OTP_MAX_PER_HOUR) {
    return { error: 'Too many codes requested. Try again later.', status: 429 }
  }

  const code = generateCode()
  const { error } = await supabase.from('withdrawal_email_otps').insert({
    user_id: user.id,
    purpose: OTP_PURPOSE,
    code_hash: hash(code, user.id),
    expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString(),
  })
  if (error) return { error: 'Could not create the code', status: 500 }
  return { code }
}

// Returns { ok: true } or { error, status }. A successful verification consumes the row.
export async function verifyWithdrawalOtp(supabase, userId, code) {
  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { error: 'Enter the 6-digit code we emailed you', status: 400 }
  }
  const { data: rows, error } = await supabase
    .from('withdrawal_email_otps')
    .select('id, code_hash, expires_at, attempts, consumed_at')
    .eq('user_id', userId)
    .eq('purpose', OTP_PURPOSE)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { error: 'Could not verify the code', status: 500 }
  const otp = rows?.[0]
  if (!otp || new Date(otp.expires_at).getTime() < Date.now()) {
    return { error: 'That code is invalid or has expired', status: 403 }
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { error: 'That code has been locked. Request a new one.', status: 403 }
  }
  if (otp.code_hash !== hash(code, userId)) {
    await supabase.from('withdrawal_email_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
    return { error: 'Incorrect code', status: 403 }
  }
  await supabase.from('withdrawal_email_otps').update({ consumed_at: new Date().toISOString() }).eq('id', otp.id)
  return { ok: true }
}
