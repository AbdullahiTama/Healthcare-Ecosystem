import crypto from 'node:crypto'
import { isProviderError, ERROR_CODES as E } from '../errors.js'
import { matchPersonName } from './nameMatch.js'

// Identity verification (KYC) for people who withdraw money: BVN + NIN, optionally a selfie.
//
// The raw BVN / NIN exist only inside one request: they go to the provider, are reduced to a keyed hash (to enforce one
// BVN / NIN per person) and the last four digits, and are never stored, logged or returned. Attempts are capped in the
// database (kyc_begin_attempt: 5 per 24 h), because every lookup costs money and could be used to probe other
// people's numbers. -> { status, body } for the HTTP layer.

function hashSecret() {
  const s = process.env.KYC_HASH_SECRET || process.env.OTP_HMAC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('KYC_HASH_SECRET (or OTP_HMAC_SECRET / SUPABASE_SERVICE_ROLE_KEY) must be set')
  return s
}

/** Keyed, domain-separated hash of an identifier: stable (for uniqueness) but useless without the server secret. */
export function hashIdentifier(kind, value) {
  return crypto.createHmac('sha256', hashSecret()).update(`${kind}:${value}`).digest('hex')
}

const isId11 = (v) => typeof v === 'string' && /^\d{11}$/.test(v)
const last4 = (v) => String(v).slice(-4)

const unavailable = { status: 502, body: { error: 'We could not reach the identity service. Try again shortly.', code: 'kyc_unavailable' } }
const notFound = { status: 422, body: { error: 'We could not verify that BVN / NIN. Check the numbers and try again.', code: 'id_not_found' } }

function fromProviderError(err) {
  if (isProviderError(err)) {
    if (err.code === E.NOT_FOUND || err.code === E.INVALID_REQUEST) return notFound
    console.error('[kyc] provider failure', { code: err.code, operation: err.operation, httpStatus: err.httpStatus })
    return unavailable
  }
  console.error('[kyc] unexpected failure', { message: String(err?.message || err).replace(/\d{11}/g, '***') })
  return unavailable
}

/** { tier, verified, bvnLast4, ninLast4, legalName } without any hash. */
export async function kycStatus(supabase, userId) {
  const { data, error } = await supabase
    .from('kyc_verifications')
    .select('tier, verified_at, bvn_last4, nin_last4, legal_first_name, legal_middle_name, legal_last_name, selfie_verified_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { status: 500, body: { error: 'Could not read your verification status' } }
  const tier = data?.tier || 0
  return {
    status: 200,
    body: {
      verified: tier >= 1,
      tier,
      bvnLast4: data?.bvn_last4 || null,
      ninLast4: data?.nin_last4 || null,
      legalName: tier >= 1 ? [data.legal_first_name, data.legal_middle_name, data.legal_last_name].filter(Boolean).join(' ') : null,
      selfieVerified: Boolean(data?.selfie_verified_at),
    },
  }
}

/** BVN + NIN -> verified identity (tier 1). */
export async function verifyIdentity({ supabase, provider, user, bvn, nin }) {
  if (!isId11(bvn) || !isId11(nin)) {
    return { status: 400, body: { error: 'Enter your 11-digit BVN and your 11-digit NIN.', code: 'invalid_id' } }
  }

  const { data: gate, error: gateError } = await supabase.rpc('kyc_begin_attempt', { p_user_id: user.id })
  if (gateError) return { status: 500, body: { error: 'Could not start verification' } }
  if (gate === 'already_verified') return { status: 409, body: { error: 'Your identity is already verified.', code: 'already_verified' } }
  if (gate === 'locked') return { status: 429, body: { error: 'Too many verification attempts. Try again in 24 hours.', code: 'kyc_locked' } }

  let bvnRecord, ninRecord
  try {
    ;[bvnRecord, ninRecord] = await Promise.all([provider.lookupBvn(bvn), provider.lookupNin(nin)])
  } catch (err) {
    const mapped = fromProviderError(err)
    return mapped
  }

  // The two records must describe the same person, or someone is combining their own BVN with another person's NIN.
  const agree = matchPersonName(`${ninRecord.firstName} ${ninRecord.middleName} ${ninRecord.lastName}`,
    { first: bvnRecord.firstName, middle: bvnRecord.middleName, last: bvnRecord.lastName })
  if (!agree.matches) {
    return { status: 422, body: { error: 'The BVN and NIN do not belong to the same person.', code: 'identity_mismatch' } }
  }

  const { data: saved, error } = await supabase.rpc('kyc_save_verified', {
    p_user_id: user.id,
    p_first: bvnRecord.firstName,
    p_middle: bvnRecord.middleName || '',
    p_last: bvnRecord.lastName,
    p_bvn_hash: hashIdentifier('bvn', bvn),
    p_bvn_last4: last4(bvn),
    p_nin_hash: hashIdentifier('nin', nin),
    p_nin_last4: last4(nin),
    p_provider_ref: bvnRecord.providerRef || null,
  })
  if (error) return { status: 500, body: { error: 'Could not save your verification' } }
  if (saved === 'bvn_in_use' || saved === 'nin_in_use') {
    return { status: 409, body: { error: 'This BVN or NIN is already linked to another account. Contact support if that is a mistake.', code: 'id_in_use' } }
  }
  if (saved === 'already_verified') return { status: 409, body: { error: 'Your identity is already verified.', code: 'already_verified' } }
  if (saved !== 'ok') return { status: 500, body: { error: 'Could not save your verification' } }

  return kycStatus(supabase, user.id)
}

/** Selfie match against the verified BVN or NIN (tier 2). The BVN / NIN must be re-entered: we do not keep them. */
export async function verifySelfie({ supabase, provider, user, bvn, selfieImage }) {
  if (!isId11(bvn)) return { status: 400, body: { error: 'Enter your 11-digit BVN.', code: 'invalid_id' } }

  const { data: row, error: readError } = await supabase.from('kyc_verifications').select('tier, bvn_hash').eq('user_id', user.id).maybeSingle()
  if (readError) return { status: 500, body: { error: 'Could not read your verification status' } }
  if (!row || row.tier < 1) return { status: 403, body: { error: 'Verify your BVN and NIN first.', code: 'kyc_required' } }
  // The BVN typed now must be the one verified earlier; otherwise the selfie proves nothing about this account.
  if (row.bvn_hash !== hashIdentifier('bvn', bvn)) return { status: 422, body: { error: 'That BVN does not match the one you verified.', code: 'id_mismatch' } }

  let result
  try {
    result = await provider.verifySelfie({ idType: 'bvn', idNumber: bvn, selfieImage })
  } catch (err) {
    return fromProviderError(err)
  }
  if (!result.matched) return { status: 422, body: { error: 'The selfie did not match. Use good light, face the camera and try again.', code: 'selfie_mismatch' } }

  const { data: saved, error } = await supabase.rpc('kyc_save_selfie', { p_user_id: user.id, p_confidence: result.confidence, p_provider_ref: result.providerRef || null })
  if (error || saved !== 'ok') return { status: 500, body: { error: 'Could not save your verification' } }
  return kycStatus(supabase, user.id)
}
