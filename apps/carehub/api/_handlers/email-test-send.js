import { emailService } from '../../src/lib/emailService.js'
import { flushOutbox } from '../_lib/outbox.js'
import { supabase } from '../_lib/supabase.js'
import { requirePlatformAdmin } from '../_lib/requirePlatformAdmin.js'
import { getTemplate, isValidEmail } from '@care-ecosystem/shared-email'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Mails any address from the trusted sender with a caller-chosen payload, so only a platform admin may call it.
  const { status: authStatus, error: authError } = await requirePlatformAdmin(req, supabase)
  if (authStatus) return res.status(authStatus).json({ error: authError })

  const { templateKey, toEmail, payload } = req.body || {}
  if (!templateKey || !toEmail) return res.status(400).json({ error: 'templateKey and toEmail are required' })
  // getTemplate is per-app and fails closed: only a template CareHub can actually render is accepted.
  if (typeof templateKey !== 'string' || !getTemplate(templateKey, 'carehub')) {
    return res.status(400).json({ error: `Unknown templateKey: ${String(templateKey).slice(0, 64)}` })
  }
  if (!isValidEmail(toEmail)) return res.status(400).json({ error: 'toEmail must be a valid email address' })

  try {
    const row = await emailService.enqueue({ templateKey, toEmail, payload, subject: `[TEST] ${templateKey}` })
    await flushOutbox()
    return res.status(202).json({ ok: true, outboxId: row.id, message: `Test email queued to ${toEmail}` })
  } catch (e) {
    console.error('[email/test-send] failed', e)
    return res.status(500).json({ error: e.message })
  }
}
