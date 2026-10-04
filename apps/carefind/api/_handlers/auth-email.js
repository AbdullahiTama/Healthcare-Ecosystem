// /api/auth-email
// Sends auth-flow emails (password_reset / email_verification / welcome)
// through the templated outbox, replacing Supabase's built-in auth emails.
// Link generation happens server-side via the service-role admin client.
//
// Security: this endpoint intentionally supports pre-session callers (a user
// requesting a reset link is not signed in). It never reveals whether an
// account exists: every outcome (sent, no such account, rate limited, failed)
// answers the same { ok: true }, and each response is held to a minimum
// duration so the extra work done for a real account is not a timing signal.
// Per-address rate limits live in shared-email's sendAuthEmail.

import { createClient } from '@supabase/supabase-js'

// The only actions CareFind needs without a session. staff_setup is a CareHub action and needs an authorised caller.
const PUBLIC_ACTIONS = ['password_reset', 'email_verification', 'customer_registration']

// Resolving an account, minting a link, queueing and sending take noticeably longer than "no such account", so each
// response is padded up to a floor. Operators can tune it without a deploy; 0 disables it (tests).
function minResponseMs() {
  const n = Number(process.env.AUTH_EMAIL_MIN_RESPONSE_MS)
  return Number.isFinite(n) && n >= 0 ? n : 1500
}
async function padResponse(startedAt) {
  const wait = minResponseMs() - (Date.now() - startedAt)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const startedAt = Date.now()

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const { action, email, fullName, redirectTo } = req.body || {}
  if (!action || !email) return res.status(400).json({ error: 'action and email are required' })
  if (!PUBLIC_ACTIONS.includes(action)) return res.status(400).json({ error: `Unsupported action ${String(action).slice(0, 32)}` })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // The account lookup itself lives in shared-email: generateLink resolves the
  // user and returns an error when the address has no account, which is how
  // "unknown address" is detected without ever querying auth by email. This
  // callback only personalises the copy.
  // supabase-js query builders are thenables, not Promises, so they have no
  // .catch(). They also never throw for a query error — they resolve to
  // { data: null, error }, which the optional chaining below already absorbs.
  const resolveDisplayName = async (authUser) => {
    if (!authUser?.id) return ''
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', authUser.id)
      .maybeSingle()
    return profile?.full_name || ''
  }

  try {
    const { sendAuthEmail } = await import('@care-ecosystem/shared-email')
    await sendAuthEmail({
      action,
      email,
      fullName,
      redirectTo: redirectTo || process.env.CAREFIND_APP_URL || process.env.APP_URL || '',
      app: 'carefind',
      supabase,
      resolveDisplayName,
    })
    // `sent` is deliberately not returned: false meant "no such account".
    await padResponse(startedAt)
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[auth-email] dispatch failed:', err)
    // Generic success — never leak whether the account exists.
    await padResponse(startedAt)
    return res.status(200).json({ ok: true })
  }
}