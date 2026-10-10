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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const body = req.body || {}
  const business = {}
  for (const key of BUSINESS_FIELDS) if (body[key] !== undefined && body[key] !== null) business[key] = body[key]

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
  try {
    const { sendAuthEmail } = await import('@care-ecosystem/shared-email')
    const base = process.env.CAREHUB_APP_URL || process.env.APP_URL || ''
    await sendAuthEmail({
      action: 'owner_setup',
      email,
      fullName: String(business.owner).trim(),
      businessName: String(business.name).trim(),
      redirectTo: `${base}/reset-password?welcome=1`,
      app: 'carehub',
      supabase,
    })
  } catch (err) {
    console.error('[register-business] setup email failed:', err?.message)
  }

  return res.status(200).json({ ok: true })
}
