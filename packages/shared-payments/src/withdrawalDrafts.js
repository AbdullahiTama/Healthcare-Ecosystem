// Server-backed pre-reservation withdrawal drafts (Phase 1): the server owns the
// amount/destination a withdrawal OTP was issued for, so a reload can resume the
// form without storing any secret. No money moves here; no PIN/OTP/raw account
// numbers are ever stored (typed destinations are an HMAC fingerprint).
import crypto from 'node:crypto'
import { OTP_TTL_SECONDS } from './otp.js'

/**
 * The moment a withdrawal code actually stops working, as an ISO string, or null when the
 * draft carries no issue time.
 *
 * A draft lives 10 minutes (`carefind_20261104_withdrawal_drafts.sql`) but a code lives
 * OTP_TTL_SECONDS (5). Painting the draft's expiry promised the user up to five extra
 * minutes and then failed them with `otp_expired`, which reads as "I did everything right".
 * The code's own expiry always wins; the draft expiry is only a ceiling.
 */
export function draftOtpExpiresAt(draft, otpTtlSeconds = OTP_TTL_SECONDS) {
  if (!draft) return null
  const issued = Date.parse(draft.otp_issued_at)
  if (!Number.isFinite(issued)) return null
  const otpExpiry = new Date(issued + otpTtlSeconds * 1000)
  const draftExpiry = Date.parse(draft.draft_expires_at)
  if (!Number.isFinite(draftExpiry)) return otpExpiry.toISOString()
  return new Date(Math.min(otpExpiry.getTime(), draftExpiry)).toISOString()
}

/**
 * What a draft is safe to tell a browser about. `destination_fp` is server-side HMAC
 * material for the submit gate and never leaves the server; instead we report only whether
 * the destination was a SAVED account (and which id the caller already owns) or a typed one,
 * plus the already-masked digits the client displays.
 */
export function describeWithdrawalDraft(draft) {
  if (!draft) return null
  const { destination_fp: fp, ...rest } = draft
  const savedId = typeof fp === 'string' && fp.startsWith('saved:') ? fp.slice('saved:'.length) : null
  return {
    ...rest,
    destinationKind: savedId ? 'saved' : 'typed',
    savedAccountId: savedId,
    otpExpiresAt: draftOtpExpiresAt(draft),
  }
}

function draftSecret() {
  const dedicated = process.env.OTP_HMAC_SECRET
  if (dedicated) return dedicated
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OTP_HMAC_SECRET must be set in production (the service-role key is not accepted as a draft hashing key)')
  }
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!fallback) throw new Error('OTP_HMAC_SECRET (or SUPABASE_SERVICE_ROLE_KEY outside production) must be set')
  return fallback
}
export function destinationFingerprint({ userId, savedId, bankCode, accountNumber }) {
  if (savedId) return `saved:${savedId}`
  return 'typed:' + crypto.createHmac('sha256', draftSecret()).update(`draft:${userId}:${bankCode}:${accountNumber}`).digest('hex')
}
export async function createWithdrawalDraft(supabase, { userId, app, amount, unit, destination }) {
  const fp = destinationFingerprint({ userId, ...destination })
  const { data, error } = await supabase.rpc('create_withdrawal_draft', { p_user_id: userId, p_app: app, p_amount: amount, p_unit: unit, p_destination_fp: fp })
  if (error) throw new Error(`draft create failed: ${error.message}`)
  return { ...data, fingerprint: fp }
}
export async function getWithdrawalDraft(supabase, { userId }) {
  const { data, error } = await supabase.from('withdrawal_drafts').select('id,app,amount,unit,destination_fp,destination_mask,draft_expires_at,otp_issued_at').eq('user_id', userId).is('voided_at', null).gt('draft_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  return data || null
}
export async function voidWithdrawalDraft(supabase, { userId, reason }) {
  const { error } = await supabase.rpc('void_withdrawal_draft', { p_user_id: userId, p_reason: reason })
  if (error) throw new Error(`draft void failed: ${error.message}`)
}
