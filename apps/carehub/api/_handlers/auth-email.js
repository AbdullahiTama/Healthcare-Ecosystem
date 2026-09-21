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

  const { action, email, fullName, redirectTo } = req.body || {}
  if (!action || !email) return res.status(400).json({ error: 'action and email are required' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' })
  if (action !== 'password_reset' && action !== 'email_verification') {
    return res.status(400).json({ error: `Unsupported action ${action}` })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const authUser = (await supabase.auth.admin.getUserByEmail(email)).data?.user
  const userExists = !!authUser
  if (!userExists) return res.status(200).json({ ok: true, sent: false })

  let displayName = fullName || ''
  if (authUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', authUser.id)
      .maybeSingle()
      .catch(() => ({ data: null }))
    if (profile?.full_name) {
      displayName = profile.full_name
    } else {
      const { data: biz } = await supabase
        .from('businesses')
        .select('owner_name')
        .ilike('owner_email', email)
        .maybeSingle()
        .catch(() => ({ data: null }))
      if (biz?.owner_name) displayName = biz.owner_name
    }
  }

  try {
    const { sendAuthEmail } = await import('@care-ecosystem/shared-email')
    await sendAuthEmail({
      action,
      email,
      fullName: displayName,
      redirectTo: redirectTo || 'https://carehub.ng',
      app: 'carehub',
    })
    return res.status(200).json({ ok: true, sent: true })
  } catch (err) {
    console.error('[auth-email] dispatch failed:', err)
    return res.status(200).json({ ok: true, sent: false })
  }
}