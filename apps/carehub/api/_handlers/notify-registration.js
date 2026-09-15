import { emailService } from '../../src/lib/emailService.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { businessName, ownerName, businessType, state, email } = req.body || {}

  if (!businessName || !ownerName || !email) {
    return res.status(400).json({ error: 'Missing businessName, ownerName or email' })
  }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))
  if (!emailOk) return res.status(400).json({ error: 'Invalid email' })

  // Enqueue both emails; the worker handles delivery. Never block registration on email failure.
  try {
    await Promise.allSettled([
      emailService.enqueue({
        templateKey: 'registration_owner',
        toEmail: email,
        payload: { businessName, ownerName },
        subject: `CareHub — Registration received for ${businessName} (under review)`,
      }),
      emailService.enqueue({
        templateKey: 'admin_new_registration',
        toEmail: process.env.ADMIN_EMAIL || 'admin@carehub.ng',
        payload: { businessName, ownerName, businessType: businessType || '—', state: state || '—', email },
        subject: `🔔 New Registration: ${businessName} — Awaiting Approval`,
      }),
    ])
  } catch (e) {
    console.warn('[notify-registration] enqueue failed', e)
  }

  return res.status(200).json({ ok: true })
}
