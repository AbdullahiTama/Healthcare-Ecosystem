import { createClient } from '@supabase/supabase-js'

// Cron: scan businesses whose plan expires within the notice window and
// enqueue a subscription_expiry email to the owner. Guarded by CRON_SECRET,
// idempotent (dedupes against recently-sent outbox rows for the same
// business + template), and never blocks the cron response on email delivery.

const NOTICE_DAYS = 7

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token && process.env.CRON_SECRET) {
    if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const now = new Date()
  const horizon = new Date(Date.now() + NOTICE_DAYS * 24 * 60 * 60 * 1000)

  try {
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, name, plan, plan_expires_at, owner_name, owner_email, email, status')
      .gt('plan_expires_at', now.toISOString())
      .lte('plan_expires_at', horizon.toISOString())
      .eq('status', 'active')

    if (error) throw error

    const { EmailService } = await import('@care-ecosystem/shared-email')
    const emailService = new EmailService()

    let enqueued = 0
    let skipped = 0

    for (const biz of businesses || []) {
      const ownerEmail = biz.owner_email || biz.email
      if (!ownerEmail) { skipped++; continue }

      const expiry = new Date(biz.plan_expires_at)
      const daysLeft = Math.max(1, Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))

      // Dedupe: skip if a subscription_expiry email for this business was
      // already enqueued in the past 7 days.
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: existing } = await supabase
        .from('email_outbox')
        .select('id')
        .eq('template_key', 'subscription_expiry')
        .eq('to_email', ownerEmail)
        .gte('created_at', sevenDaysAgo)
        .maybeSingle()
      if (existing) { skipped++; continue }

      // Routed through the shared service instead of a raw insert. The raw
      // insert omitted app and event_key, so guard_email_outbox_quarantine()
      // parked every one of these rows with quarantine_reason=
      // 'legacy_mapping_unproven' and next_retry_at='infinity'. The enqueue
      // appeared to succeed and the email was silently undeliverable, which is
      // why this cron reported enqueued counts while nothing was ever sent.
      //
      // app is passed explicitly rather than inferred from the sender: enqueue
      // defaults from_email to the CareHub address, and a mis-resolved app
      // would fail closed with no_template:carehub:subscription_expiry because
      // the CareHub renderer set has no such key.
      let row = null
      try {
        row = await emailService.enqueue({
          templateKey: 'subscription_expiry',
          toEmail: ownerEmail,
          fromEmail: process.env.RESEND_FROM_EMAIL || 'CareFind <support@mail.carefind.app>',
          app: 'carefind',
          eventKey: 'subscription_expiry',
          payload: {
            fullName: biz.owner_name || 'Business Owner',
            plan: biz.plan || 'Standard',
            businessName: biz.name,
            expiryDate: expiry.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            daysLeft,
          },
        })
      } catch (enqErr) {
        console.error('[cron/check-subscription-expiry] enqueue failed', enqErr)
        skipped++
        continue
      }
      if (!row) { skipped++; continue }
      enqueued++
    }

    // Flush immediately so the daily outbox cron is only a retry fallback.
    emailService.processBatch().catch((err) => {
      console.error('[cron/check-subscription-expiry] flush failed', err)
    })

    return res.status(200).json({ ok: true, scanned: (businesses || []).length, enqueued, skipped })
  } catch (e) {
    console.error('[cron/check-subscription-expiry] failed', e)
    return res.status(500).json({ error: e.message })
  }
}