// Server-backed pre-reservation withdrawal drafts (Phase 1): the server owns the
// amount/destination a withdrawal OTP was issued for, so a reload can resume the
// form without storing any secret. No money moves here; no PIN/OTP/raw account
// numbers are ever stored (typed destinations are an HMAC fingerprint).
import crypto from 'node:crypto'
function draftSecret() { return process.env.OTP_HMAC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY }
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
  const { data, error } = await supabase.from('withdrawal_drafts').select('id,app,amount,unit,destination_mask,draft_expires_at,otp_issued_at').eq('user_id', userId).is('voided_at', null).gt('draft_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  return data || null
}
