// Auth-flow emails (password reset / email verification / welcome) delivered
// through the templated outbox instead of Supabase's built-in auth emails.
// Server-side-only: link generation requires the service-role client, which
// must never be exposed to the browser.

let _createClient = null
async function deps() {
  if (!_createClient) {
    const mod = await import('@supabase/supabase-js')
    _createClient = mod.createClient
  }
  return _createClient
}

// An injected client is strongly preferred and is what both apps do. A bare
// '@supabase/supabase-js' specifier only resolves by walking up from this file,
// and on Vercel the workspace package is deployed without its own node_modules,
// so the lookup misses and dispatch dies with "Cannot find package
// '@supabase/supabase-js'" — the same trap EmailService documents. The fallback
// exists for local/dev use only.
async function getAdminClient(supabase) {
  if (supabase) return supabase
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  const createClient = await deps()
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const APP_BRANDING = {
  carefind: {
    app: 'carefind',
    label: 'CareFind',
    fromEmail: 'CareFind <support@mail.carefind.app>',
    defaultRedirect: process.env.APP_URL || 'https://carefind.app',
  },
  carehub: {
    app: 'carehub',
    label: 'CareHub',
    fromEmail: 'CareHub <support@mail.carefindhub.com>',
    defaultRedirect: process.env.APP_URL || 'https://carefindhub.com',
  },
}

function renderDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Send an auth-flow email. Resolves to { ok: true, sent: boolean }.
// `sent` is false when the address has no account — that is a normal outcome,
// not an error, so it must not throw: callers answer every pre-session
// request with a generic 200 to avoid leaking which addresses are registered.
//
// action: 'password_reset' | 'email_verification' | 'customer_registration'
// supabase: optional pre-built service-role client. Callers should pass one —
//   see getAdminClient for why resolving supabase-js from here is unsafe.
// resolveDisplayName: optional async (authUser) => string. Called with the user
//   record that generateLink returns, so each app can resolve a name from its
//   own schema without this module knowing about profiles or businesses.
export async function sendAuthEmail({
  action,
  email,
  fullName = '',
  redirectTo,
  app = 'carefind',
  supabase,
  resolveDisplayName,
}) {
  if (!email) throw new Error('email is required')

  const allowed = ['password_reset', 'email_verification', 'customer_registration']
  if (!allowed.includes(action)) throw new Error(`Unsupported auth action: ${action}`)

  const branding = APP_BRANDING[app] || APP_BRANDING.carefind
  const { EmailService } = await import('./EmailService.js')
  // Reuses the caller's client so the outbox flush does not build a second one.
  const emailService = new EmailService({ supabase })

  const toEmail = email.trim().toLowerCase()
  const baseRedirect = redirectTo || branding.defaultRedirect

  // For reset / verify we must mint a real action link via the admin API;
  // the client-facing app only swaps in the template. Plaintext links are
  // never passed from browser → server.
  if (action === 'password_reset' || action === 'email_verification') {
    const admin = await getAdminClient(supabase)
    const type = action === 'password_reset' ? 'recovery' : 'signup'
    // generateLink both resolves the account and mints the link, so it is also
    // the existence check — the admin API has no getUserByEmail to call.
    const { data, error } = await admin.auth.admin.generateLink({
      type,
      email: toEmail,
      options: { redirectTo: baseRedirect },
    })
    if (error || !data) return { ok: true, sent: false }

    const actionLink = data?.properties?.action_link || data?.properties?.email_otp || ''
    if (!actionLink) throw new Error('Could not generate auth link')

    const resolved = resolveDisplayName ? await resolveDisplayName(data.user) : ''
    const displayName = (resolved || '').trim() || fullName.trim() || toEmail.split('@')[0]

    const templateKey = action === 'password_reset' ? 'password_reset' : 'email_verification'
    const payload = action === 'password_reset'
      ? { fullName: displayName, resetLink: actionLink }
      : { fullName: displayName, verifyLink: actionLink }

    await emailService.enqueue({
      templateKey,
      toEmail: toEmail,
      fromEmail: branding.fromEmail,
      app: branding.app,
      eventKey: templateKey,
      payload,
      subject: action === 'password_reset'
        ? 'Reset your password'
        : 'Verify your email address',
    })
  } else {
    // Welcome email — no link required, and no auth record to resolve a
    // name from, so the caller-supplied name is the only signal available.
    const displayName = fullName.trim() || toEmail.split('@')[0]
    await emailService.enqueue({
      templateKey: 'customer_registration',
      toEmail: toEmail,
      fromEmail: branding.fromEmail,
      app: branding.app,
      eventKey: 'customer_registration',
      payload: { fullName: displayName, email: toEmail },
      subject: `Welcome to ${branding.label}!`,
    })
  }

  // Awaited deliberately. A fire-and-forget flush gets frozen the moment the
  // serverless invocation returns its response, so the email would sit in the
  // outbox until the next cron — and the cron runs once a day, not per minute.
  // A delivery failure is logged but not rethrown: the row is enqueued and
  // retryable, and the caller must still return a generic 200.
  try {
    await emailService.processBatch()
  } catch (err) {
    console.error(`[auth-email] outbox flush error (${action}):`, err)
  }

  return { ok: true, sent: true }
}