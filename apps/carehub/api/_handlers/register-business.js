// POST /api/register-business
// The only way to register a CareHub business. The database function that does the work is service-role only, so
// this handler is the enforcement point: the owner's account is created UNCONFIRMED and they must open the emailed
// link (which also lets them choose a password) before they can sign in or be reviewed.
//
// Only the columns in BUSINESS_FIELDS are forwarded, so a caller cannot set status, plan or admin flags. No password
// is accepted: one is never typed before ownership of the address is proven.

import { createClient } from '@supabase/supabase-js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BUSINESS_FIELDS = [
  'name', 'owner', 'email', 'phone', 'whatsapp', 'address', 'state', 'city', 'business_type', 'hours',
  'maps_link', 'lat', 'lng', 'website', 'visible_on_carefind', 'referral_code_used',
]
// Text columns must be strings when present. Lengths: TEXT_MAX where listed, DEFAULT_TEXT_MAX otherwise.
const TEXT_FIELDS = [
  'name', 'owner', 'email', 'phone', 'whatsapp', 'address', 'state', 'city', 'business_type', 'hours',
  'maps_link', 'website', 'referral_code_used',
]
const TEXT_MAX = { name: 160, owner: 120, email: 254 }
const DEFAULT_TEXT_MAX = 500
const COORD_RANGE = { lat: 90, lng: 180 }

// Returns the field name of the first invalid value, or null. Coerces lat/lng in place to numbers.
function invalidField(business) {
  for (const key of TEXT_FIELDS) {
    if (business[key] === undefined) continue
    if (typeof business[key] !== 'string' || business[key].length > (TEXT_MAX[key] ?? DEFAULT_TEXT_MAX)) return key
  }
  for (const [key, limit] of Object.entries(COORD_RANGE)) {
    if (business[key] === undefined) continue
    const raw = business[key]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(n) || n < -limit || n > limit) return key
    business[key] = n
  }
  if (business.visible_on_carefind !== undefined && typeof business.visible_on_carefind !== 'boolean') {
    return 'visible_on_carefind'
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }
  // Checked before anything is created: without it the emailed link cannot reach /reset-password, so the owner
  // would be left with an account they cannot finish setting up.
  const appBase = process.env.CAREHUB_APP_URL || process.env.APP_URL
  if (!appBase) return res.status(500).json({ error: 'Server misconfigured: CAREHUB_APP_URL is not set' })

  const raw = req.body
  // A string, array or null body has no usable fields; it falls through to the missing-email error below.
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const business = {}
  for (const key of BUSINESS_FIELDS) if (body[key] !== undefined && body[key] !== null) business[key] = body[key]

  const bad = invalidField(business)
  if (bad) return res.status(400).json({ error: `Invalid ${bad}` })

  const email = String(business.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required.' })
  if (!String(business.name || '').trim()) return res.status(400).json({ error: 'Business name is required.' })
  if (!String(business.owner || '').trim()) return res.status(400).json({ error: 'Owner name is required.' })
  business.email = email

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { error } = await supabase.rpc('register_business_unconfirmed', { p_business: business })
  if (error) {
    // `raise exception` in the function (P0001) carries a message written for the owner. Anything else is an
    // internal failure and must not leak table or function names.
    if (error.code === 'P0001') return res.status(400).json({ error: error.message })
    console.error('[register-business] rpc failed:', error.code)
    return res.status(500).json({ error: 'Registration failed. Please try again.' })
  }

  // Best effort: registration has succeeded. If the email cannot be sent, the owner recovers through
  // "Forgot password", which sends the same kind of link and also confirms the address.
  // The owner's and business's names are NOT passed: this is a public endpoint, so they are text a stranger chose,
  // and they must not appear in a branded email sent to whatever address was typed. The template uses neutral copy.
  try {
    const { sendAuthEmail } = await import('@care-ecosystem/shared-email')
    await sendAuthEmail({
      action: 'owner_setup',
      email,
      redirectTo: `${appBase}/reset-password?welcome=1`,
      app: 'carehub',
      supabase,
    })
  } catch (err) {
    console.error('[register-business] setup email failed:', err?.message)
  }

  return res.status(200).json({ ok: true })
}
