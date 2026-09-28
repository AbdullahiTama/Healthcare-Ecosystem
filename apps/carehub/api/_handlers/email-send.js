import { emailService } from '../../src/lib/emailService.js'
import { supabase } from '../_lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Missing authorization' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  // subject is deliberately not read from the request. It used to be, which let
  // any authenticated user set the subject line of a CareHub-branded email to
  // arbitrary text. The subject is part of the template contract now and is
  // resolved by the worker from the key's canonical subject in the registry.
  const { templateKey, toEmail, payload } = req.body || {}
  if (!templateKey || !toEmail) {
    return res.status(400).json({ error: 'templateKey and toEmail are required' })
  }

  // agent_approved and agent_rejected were missing here, so the referral panel's
  // only two live email calls got a 400 and the agent was never told. They are
  // listed only because they have renderers and live callers.
  const allowedTemplates = ['registration_owner', 'admin_new_registration', 'business_approved', 'business_rejected', 'business_suspended', 'appointment_confirmed', 'staff_welcome', 'agent_approved', 'agent_rejected']
  if (!allowedTemplates.includes(templateKey)) {
    return res.status(400).json({ error: `Invalid templateKey. Allowed: ${allowedTemplates.join(', ')}` })
  }

  try {
    const row = await emailService.enqueue({ templateKey, toEmail, payload })
    if (!row) {
      console.error('[email/send] enqueue returned no row', { templateKey })
      return res.status(500).json({ error: 'Enqueue failed' })
    }
    // Low-latency path, kept deliberately. The minute cron is the durable
    // dispatcher, but it is not verified working yet (its Vault secrets are
    // unset) and the Vercel fallback is daily, so dropping this would park
    // referral emails for up to a day. It is no longer a double-send risk:
    // claims make a request-triggered flush and a concurrent cron run contend
    // for the same row instead of both sending it.
    emailService.processBatch().catch(e => console.error('[email/send] immediate process failed', e))
    return res.status(202).json({ ok: true, outboxId: row.id })
  } catch (e) {
    console.error('[email/send] enqueue failed', e)
    return res.status(500).json({ error: e.message })
  }
}
