import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './email.js'
import { EmailService } from '@care-ecosystem/shared-email'
import { renderEmailTemplate } from './emailTemplateRenderer.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const emailService = new EmailService()

const HARDCODED_FALLBACKS = {
  order_confirmation: (vars) => buildOrderConfirmationHtml(vars),
}

export async function renderTemplate(slug, variables) {
  const { data: template } = await supabase
    .from('email_templates').select('id, html_body, variables, subject').eq('slug', slug).eq('is_active', true).maybeSingle()
  if (!template) return null
  const html = sharedRenderTemplate(template.html_body, variables)
  return { html, subject: template.subject, variables: template.variables }
}

export async function sendTemplatedEmail({ to, slug, variables, subject: overrideSubject }) {
  const rendered = await renderTemplate(slug, variables)
  if (rendered) return sendEmail({ to, subject: overrideSubject || rendered.subject, html: rendered.html })
  const fallbackBuilder = HARDCODED_FALLBACKS[slug]
  if (fallbackBuilder) return sendEmail({ to, subject: overrideSubject || slug.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()), html: fallbackBuilder(variables || {}) })
  return { success: false, error: `No template found for slug: ${slug}` }
}

export async function enqueue({ templateKey, toEmail, payload, subject }) {
  return emailService.enqueue({ templateKey, toEmail, payload, subject })
}

export async function processBatch() {
  return emailService.processBatch()
}

export { emailService }
