import { checkWithdrawalPin } from './pin.js'
import { clientIp } from './otp.js'
import { sendSecurityAlert } from './alerts.js'
import { kycStatus, verifyIdentity, verifySelfie } from './kyc/identity.js'
import { isKycEnabled } from './withdrawalLimits.js'
import {
  addPayoutAccount, listPayoutAccounts, removePayoutAccount, sendPayoutAccountOtp, setDefaultPayoutAccount,
} from './payoutAccounts.js'

// The HTTP layer for identity verification and saved payout accounts, built once and mounted by BOTH apps so the rules
// cannot drift apart. Each app only supplies WHO is calling: `authenticate(req)` ->
//   { user, ownerType: 'user'|'business', ownerId, businessName? }   or   { status, error }
// (CareFind: the signed-in person owns their accounts. CareHub: the verified OWNER of the business owns the business's
// accounts, while the person - not the business - is who gets KYC'd, receives codes, and holds the PIN.)

const subPath = (req) => {
  const segments = (req.url || '').split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean)
  if (segments[0] === 'api') segments.shift()
  return segments[1] || ''
}
const send = (res, r) => res.status(r.status).json(r.body)

/** POST /api/kyc/{status,verify,selfie} */
export function createKycHandler({ supabase, authenticate, getProvider }) {
  return async function kycHandler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const auth = await authenticate(req)
    if (auth.error) return res.status(auth.status || 401).json({ error: auth.error })
    const { user } = auth
    const body = req.body || {}
    const action = subPath(req)

    // H06: identity verification is OFF unless financial_config.kyc_enabled = 1. While it is off nothing here reads a KYC
    // row, constructs the provider or can cost a paid lookup; status answers "not enabled" so an older client keeps working.
    if (!(await isKycEnabled(supabase))) {
      if (action === 'status') return res.status(200).json({ enabled: false, verified: false, tier: 0, bvnLast4: null, ninLast4: null, legalName: null, selfieVerified: false })
      if (action === 'verify' || action === 'selfie') return res.status(404).json({ error: 'Identity verification is not available.', code: 'kyc_disabled' })
      return res.status(404).json({ error: 'Unknown verification action' })
    }

    switch (action) {
      case 'status':
        return send(res, await kycStatus(supabase, user.id))
      case 'verify':
        return send(res, await verifyIdentity({ supabase, provider: getProvider(), user, bvn: body.bvn, nin: body.nin }))
      case 'selfie':
        return send(res, await verifySelfie({ supabase, provider: getProvider(), user, bvn: body.bvn, selfieImage: body.selfieImage }))
      default:
        return res.status(404).json({ error: 'Unknown verification action' })
    }
  }
}

/** POST /api/payout-accounts/{list,otp,add,default,remove} */
export function createPayoutAccountsHandler({ supabase, authenticate, resolveAccount, banks, getMailer }) {
  return async function payoutAccountsHandler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const auth = await authenticate(req)
    if (auth.error) return res.status(auth.status || 401).json({ error: auth.error })
    const { user, ownerType, ownerId } = auth
    const body = req.body || {}
    const owner = { ownerType, ownerId }

    switch (subPath(req)) {
      case 'list':
        return send(res, await listPayoutAccounts(supabase, { ...owner, userId: user.id }))

      case 'otp':
        return send(res, await sendPayoutAccountOtp({ supabase, user, mailer: await getMailer(), ip: clientIp(req) }))

      case 'add':
        return send(res, await addPayoutAccount({
          supabase, user, ...owner, resolveAccount, banks, mailer: await getMailer(),
          bankCode: body.bankCode, accountNumber: body.accountNumber, otp: body.otp,
        }))

      case 'default':
        return send(res, await setDefaultPayoutAccount({ supabase, user, ...owner, id: body.id, mailer: await getMailer() }))

      case 'remove': {
        // Removing a payout account changes where money can go, so it needs the same second factor as withdrawing.
        const pin = await checkWithdrawalPin(supabase, user.id, body.pin, {
          onLocked: () => sendSecurityAlert('pin_locked', async () => (await getMailer()).sendPinLocked({ to: user.email })),
        })
        if (!pin.ok) return res.status(pin.status).json({ error: pin.error, code: pin.code, ...(pin.code === 'pin_not_set' ? { needsPin: true } : {}) })
        return send(res, await removePayoutAccount({ supabase, user, ...owner, id: body.id, mailer: await getMailer() }))
      }

      default:
        return res.status(404).json({ error: 'Unknown payout account action' })
    }
  }
}
