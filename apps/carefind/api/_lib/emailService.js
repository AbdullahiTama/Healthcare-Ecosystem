import { createClient } from '@supabase/supabase-js'
import { renderEmailTemplate } from './emailTemplateRenderer.js'
import { sendEmail, buildOrderConfirmationHtml } from './email.js'

function getServiceClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const HARDCODED_FALLBACKS = {
  order_confirmation: buildOrderConfirmationHtml,
}

export async function renderTemplate(slug, variables) {
  const sb = getServiceClient()
  if (!sb) return null

  const { data: template } = await sb
    .from('email_templates')
    .select('id, html_body, variables, subject')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()

  if (!template) return null

  const html = renderEmailTemplate(template.html_body, variables)
  return { html, subject: template.subject, variables: template.variables }
}

export async function sendTemplatedEmail({ to, slug, variables, subject: overrideSubject }) {
  const rendered = await renderTemplate(slug, variables)

  if (rendered) {
    return sendEmail({
      to,
      subject: overrideSubject || rendered.subject,
      html: rendered.html,
    })
  }

  const fallbackBuilder = HARDCODED_FALLBACKS[slug]
  if (fallbackBuilder) {
    const html = fallbackBuilder(variables || {})
    return sendEmail({
      to,
      subject: overrideSubject || slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      html,
    })
  }

  return { success: false, error: `No template found for slug: ${slug}` }
}
