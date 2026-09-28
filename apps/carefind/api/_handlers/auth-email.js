// /api/auth-email
// Sends auth-flow emails (password_reset / email_verification / welcome)
// through the templated outbox, replacing Supabase's built-in auth emails.
// Link generation happens server-side via the service-role admin client.
//
// Security: this endpoint intentionally supports pre-session callers (a user
// requesting a reset link is not signed in). It never reveals whether an
// account exists — password_reset / email_verification return a generic 200
// regardless, and the email only goes to the address in the request.
// Rate limiting should be layered at the edge (see supabase auth docs).

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const { action, email, fullName, redirectTo } = req.body || {}
  if (!action || !email) return res.status(400).json({ error: 'action and email are required' })
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
    const result = await sendAuthEmail({
      action,
      email,
      fullName,
      redirectTo: redirectTo || process.env.APP_URL || 'https://carefind.app',
      app: 'carefind',
      supabase,
      resolveDisplayName,
    })
    return res.status(200).json({ ok: true, sent: !!result?.sent })
  } catch (err) {
    console.error('[auth-email] dispatch failed:', err)
    // Generic success — never leak whether the account exists.
    return res.status(200).json({ ok: true, sent: false })
  }
}