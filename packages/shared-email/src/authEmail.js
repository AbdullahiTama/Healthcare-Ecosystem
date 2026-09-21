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

async function getAdminClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  const createClient = await deps()
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const APP_BRANDING = {
  carefind: { fromEmail: 'CareFind <support@mail.carefind.app>', defaultRedirect: 'https://carefind.app' },
  carehub: { fromEmail: 'CareHub <support@mail.carefind.app>', defaultRedirect: 'https://carehub.ng' },
}

function renderDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Send an auth-flow email. Returns { ok: true } on enqueue, or throws.
// action: 'password_reset' | 'email_verification' | 'customer_registration'
export async function sendAuthEmail({
  action,
  email,
  fullName = '',
  redirectTo,
  app = 'carefind',
}) {
  if (!email) throw new Error('email is required')

  const allowed = ['password_reset', 'email_verification', 'customer_registration']
  if (!allowed.includes(action)) throw new Error(`Unsupported auth action: ${action}`)

  const branding = APP_BRANDING[app] || APP_BRANDING.carefind
  const { EmailService } = await import('./EmailService.js')
  const emailService = new EmailService()

  const toEmail = email.trim().toLowerCase()
  const displayName = fullName.trim() || toEmail.split('@')[0]
  const baseRedirect = redirectTo || branding.defaultRedirect

  // For reset / verify we must mint a real action link via the admin API;
  // the client-facing app only swaps in the template. Plaintext links are
  // never passed from browser → server.
  if (action === 'password_reset' || action === 'email_verification') {
    const admin = await getAdminClient()
    const type = action === 'password_reset' ? 'recovery' : 'signup'
    const { data, error } = await admin.auth.admin.generateLink({
      type,
      email: toEmail,
      options: { redirectTo: baseRedirect },
    })
    if (error) throw error

    const actionLink = data?.properties?.action_link || data?.properties?.email_otp || ''
    if (!actionLink) throw new Error('Could not generate auth link')

    const templateKey = action === 'password_reset' ? 'password_reset' : 'email_verification'
    const payload = action === 'password_reset'
      ? { fullName: displayName, resetLink: actionLink }
      : { fullName: displayName, verifyLink: actionLink }

    await emailService.enqueue({
      templateKey,
      toEmail: toEmail,
      fromEmail: branding.fromEmail,
      payload,
      subject: action === 'password_reset'
        ? 'Reset your password'
        : 'Verify your email address',
    })
  } else {
    // Welcome email — no link required.
    await emailService.enqueue({
      templateKey: 'customer_registration',
      toEmail: toEmail,
      fromEmail: branding.fromEmail,
      payload: { fullName: displayName, email: toEmail },
      subject: 'Welcome to CareFind!',
    })
  }

  emailService.processBatch().catch((err) => {
    console.error(`[auth-email] outbox flush error (${action}):`, err)
  })

  return { ok: true }
}