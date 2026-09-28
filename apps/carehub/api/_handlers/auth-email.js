// /api/auth-email (CareHub)
// Sends auth-flow emails (password_reset / email_verification) through the
// templated outbox, replacing Supabase's built-in auth emails. Link
// generation happens server-side via the service-role admin client.
//
// Security: this endpoint intentionally supports pre-session callers (a user
// requesting a reset link is not signed in). It never reveals whether an
// account exists — it returns a generic 200 regardless and the email only
// goes to the address in the request. Rate limiting should be layered at the
// edge.

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  // redirectTo is deliberately not read from the body: the recovery token is
  // minted into whatever target we hand generateLink, so trusting the caller
  // here would let anyone steer a password-reset link to their own host.
  // sendAuthEmail derives the target from APP_URL plus a fixed per-app path.
  const { action, email, fullName } = req.body || {}
  if (!action || !email) return res.status(400).json({ error: 'action and email are required' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' })
  if (action !== 'password_reset' && action !== 'email_verification') {
    return res.status(400).json({ error: `Unsupported action ${action}` })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // The account lookup itself lives in shared-email: generateLink resolves the
  // user and returns an error when the address has no account. This callback
  // only personalises the copy, keeping app-specific schema out of shared-email.
  // Note that supabase-js query builders are thenables, not Promises, so they
  // have no .catch(); they report failure as { data: null, error }, which the
  // optional chaining below already absorbs.
  const resolveDisplayName = async (authUser) => {
    if (!authUser?.id) return ''
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', authUser.id)
      .maybeSingle()
    if (profile?.full_name) return profile.full_name
    const { data: biz } = await supabase
      .from('businesses')
      .select('owner_name')
      .ilike('owner_email', email.trim().toLowerCase())
      .maybeSingle()
    return biz?.owner_name || ''
  }

  try {
    const { sendAuthEmail } = await import('@care-ecosystem/shared-email')
    const result = await sendAuthEmail({
      action,
      email,
      fullName,
      app: 'carehub',
      supabase,
      resolveDisplayName,
    })
    return res.status(200).json({ ok: true, sent: !!result?.sent })
  } catch (err) {
    console.error('[auth-email] dispatch failed:', err)
    return res.status(200).json({ ok: true, sent: false })
  }
}