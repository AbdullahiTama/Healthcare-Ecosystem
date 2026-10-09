import { checkWithdrawalPin } from './pin.js'
import { kycStatus, verifyIdentity, verifySelfie } from './kyc/identity.js'
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

    switch (subPath(req)) {
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
    const { user, ownerType, ownerId, businessName } = auth
    const body = req.body || {}
    const owner = { ownerType, ownerId }

    switch (subPath(req)) {
      case 'list':
        return send(res, await listPayoutAccounts(supabase, owner))

      case 'otp':
        return send(res, await sendPayoutAccountOtp({ supabase, user, mailer: await getMailer() }))

      case 'add':
        return send(res, await addPayoutAccount({
          supabase, user, ...owner, businessName, resolveAccount, banks, mailer: await getMailer(),
          bankCode: body.bankCode, accountNumber: body.accountNumber, otp: body.otp,
        }))

      case 'default':
        return send(res, await setDefaultPayoutAccount({ supabase, ...owner, id: body.id }))

      case 'remove': {
        // Removing a payout account changes where money can go, so it needs the same second factor as withdrawing.
        const pin = await checkWithdrawalPin(supabase, user.id, body.pin)
        if (!pin.ok) return res.status(pin.status).json({ error: pin.error, code: pin.code, ...(pin.code === 'pin_not_set' ? { needsPin: true } : {}) })
        return send(res, await removePayoutAccount({ supabase, user, ...owner, id: body.id, mailer: await getMailer() }))
      }

      default:
        return res.status(404).json({ error: 'Unknown payout account action' })
    }
  }
}
