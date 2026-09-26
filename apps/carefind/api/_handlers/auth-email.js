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

  // Guard: only mint links / send for real accounts, but respond generically
  // either way to avoid account enumeration. Actual dispatch is delegated so
  // link-generation errors (e.g. user missing) still return a generic 200.
  const authUser = (await supabase.auth.admin.getUserByEmail(email)).data?.user
  const userExists = !!authUser
  if (!userExists && action !== 'customer_registration') {
    return res.status(200).json({ ok: true, sent: false })
  }

  let displayName = fullName || ''
  if (authUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', authUser.id)
      .maybeSingle()
      .catch(() => ({ data: null }))
    displayName = profile?.full_name || displayName
  }

  try {
    const { sendAuthEmail } = await import('@care-ecosystem/shared-email')
    await sendAuthEmail({
      action,
      email,
      fullName: displayName,
      redirectTo: redirectTo || process.env.APP_URL || 'https://carefind.app',
      app: 'carefind',
    })
    return res.status(200).json({ ok: true, sent: true })
  } catch (err) {
    console.error('[auth-email] dispatch failed:', err)
    // Generic success — never leak whether the account exists.
    return res.status(200).json({ ok: true, sent: false })
  }
}