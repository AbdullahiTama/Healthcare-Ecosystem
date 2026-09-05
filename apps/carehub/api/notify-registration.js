import { sendEmail, buildRegistrationOwnerHtml, buildAdminNewRegistrationHtml, ADMIN_EMAIL } from './_lib/email.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { businessName, ownerName, businessType, state, email } = req.body || {}

  if (!businessName || !ownerName || !email) {
    return res.status(400).json({ error: 'Missing businessName, ownerName or email' })
  }

  // Basic email format check
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))
  if (!emailOk) return res.status(400).json({ error: 'Invalid email' })

  // Fire both emails in parallel; never block registration on email failure.
  const ownerHtml = buildRegistrationOwnerHtml({ businessName, ownerName })
  const adminHtml = buildAdminNewRegistrationHtml({ businessName, ownerName, businessType: businessType || '—', state: state || '—', email })

  const results = await Promise.allSettled([
    sendEmail({ to: email, subject: `CareHub — Registration received for ${businessName} (under review)`, html: ownerHtml }),
    sendEmail({ to: ADMIN_EMAIL, subject: `🔔 New Registration: ${businessName} — Awaiting Approval`, html: adminHtml }),
  ])

  const ownerResult = results[0].status === 'fulfilled' ? results[0].value : { success: false, error: String(results[0].reason) }
  const adminResult = results[1].status === 'fulfilled' ? results[1].value : { success: false, error: String(results[1].reason) }

  // Always return ok — client must not show registration as failed when only email failed.
  return res.status(200).json({ ok: true, ownerEmail: ownerResult, adminEmail: adminResult })
}
