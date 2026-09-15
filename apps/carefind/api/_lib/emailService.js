import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './email.js'
import { renderEmailTemplate } from './emailTemplateRenderer.js'

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function renderTemplate(slug, variables) {
  const supabase = getSupabase()
  const { data: template } = await supabase
    .from('email_templates').select('id, html_body, variables, subject').eq('slug', slug).eq('is_active', true).maybeSingle()
  if (!template) return null
  const html = renderEmailTemplate(template.html_body, variables)
  return { html, subject: template.subject, variables: template.variables }
}

export async function sendTemplatedEmail({ to, slug, variables, subject: overrideSubject }) {
  const rendered = await renderTemplate(slug, variables)
  if (rendered) return sendEmail({ to, subject: overrideSubject || rendered.subject, html: rendered.html })
  return { success: false, error: `No template found for slug: ${slug}` }
}

export async function enqueue({ templateKey, toEmail, payload, subject }) {
  const { EmailService } = await import('@care-ecosystem/shared-email')
  const emailService = new EmailService()
  return emailService.enqueue({ templateKey, toEmail, payload, subject })
}

export async function processBatch() {
  const { EmailService } = await import('@care-ecosystem/shared-email')
  const emailService = new EmailService()
  return emailService.processBatch()
}
