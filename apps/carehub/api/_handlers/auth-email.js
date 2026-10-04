// /api/auth-email (CareHub)
// Sends auth-flow emails (password_reset / email_verification) through the
// templated outbox, replacing Supabase's built-in auth emails. Link
// generation happens server-side via the service-role admin client.
//
// Security: password_reset and email_verification intentionally support
// pre-session callers (a user locked out of their account is not signed in).
// They never reveal whether an account exists: every outcome (sent, no such
// account, rate limited, failure) answers { ok: true }, and each response is
// held to a minimum duration so the extra work for a real account is not a
// timing signal. Per-address rate limits live in shared-email's sendAuthEmail.
//
// staff_setup mints a real recovery link and says "you have been invited to
// <business> as <role>", so it is NOT public: the caller must be the signed-in
// owner of a business, the address must be on that business's staff, and the
// business name, role and person's name come from the database, never from the
// request body.

import { createClient } from '@supabase/supabase-js'

// Resolving an account, minting a link, queueing and sending take noticeably longer than "no such account", so each
// public response is padded up to a floor. Operators can tune it without a deploy; 0 disables it (tests).
function minResponseMs() {
  const n = Number(process.env.AUTH_EMAIL_MIN_RESPONSE_MS)
  return Number.isFinite(n) && n >= 0 ? n : 1500
}
async function padResponse(startedAt) {
  const wait = minResponseMs() - (Date.now() - startedAt)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

// An email address is data, not a LIKE pattern: _ and % in it must not act as wildcards.
const escapeLike = (value) => String(value).trim().replace(/[\\%_]/g, (c) => '\\' + c)

// Authorises a staff invitation. Resolves to { status: null, invite: { businessName, role, fullName } } or { status, error }.
async function authoriseStaffInvite(supabase, req, targetEmail) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { status: 401, error: 'Sign in to invite staff' }

  let result
  try {
    result = await supabase.auth.getUser(token)
  } catch {
    return { status: 401, error: 'Invalid or expired session' }
  }
  const user = result?.data?.user
  if (result?.error || !user?.id || !user.email) return { status: 401, error: 'Invalid or expired session' }
  // CareHub ties a business to its login email, so the email must be confirmed or anyone could claim a business by
  // registering its address.
  if (!user.email_confirmed_at) return { status: 403, error: 'Confirm your email address first' }

  // The top-level business row (branches share their parent's email), as verifyBusiness does.
  const { data: business } = await supabase
    .from('businesses')
    .select('id, name')
    .ilike('email', escapeLike(user.email))
    .is('parent_business_id', null)
    .limit(1)
    .maybeSingle()
  if (!business) return { status: 403, error: 'Only a business owner can invite staff' }

  const { data: staff } = await supabase
    .from('staff')
    .select('full_name, role, status')
    .eq('business_id', business.id)
    .ilike('email', escapeLike(targetEmail))
    .limit(1)
    .maybeSingle()
  if (!staff) return { status: 403, error: 'That address is not on your staff' }

  return { status: null, invite: { businessName: business.name, role: staff.role, fullName: staff.full_name } }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const startedAt = Date.now()

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  // businessName / role / fullName are deliberately not read from the body: for staff_setup they come from the database.
  const { action, email, redirectTo } = req.body || {}
  if (!action || !email) return res.status(400).json({ error: 'action and email are required' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' })
  if (action !== 'password_reset' && action !== 'email_verification' && action !== 'staff_setup') {
    return res.status(400).json({ error: `Unsupported action ${action}` })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  let invite = null
  if (action === 'staff_setup') {
    const authorised = await authoriseStaffInvite(supabase, req, email)
    if (authorised.status) return res.status(authorised.status).json({ error: authorised.error })
    invite = authorised.invite
  }

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
    await sendAuthEmail({
      action,
      email,
      redirectTo: redirectTo || process.env.CAREHUB_APP_URL || process.env.APP_URL || '',
      app: 'carehub',
      supabase,
      resolveDisplayName,
      ...(invite || {}),
    })
    // `sent` is deliberately not returned: false meant "no such account".
    if (!invite) await padResponse(startedAt)
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[auth-email] dispatch failed:', err)
    if (!invite) await padResponse(startedAt)
    return res.status(200).json({ ok: true })
  }
}