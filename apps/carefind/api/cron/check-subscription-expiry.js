import { createClient } from '@supabase/supabase-js'
import { reminderStage, reminderKey } from '../_lib/planReminders.js'

// Cron (daily): plan reminder emails to CareHub business owners, before and after expiry (_lib/planReminders.js has
// the schedule). Guarded by CRON_SECRET. Each reminder is sent once: its idempotency key is unique in email_outbox, so
// a re-run cannot mail twice. Sent as CareHub (sender and branding): the email service picks the brand from the sender.

const HORIZON_DAYS = 14
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  // Fail closed (Financial-Architecture-Audit F-21). This guard used to read `if (token && process.env.CRON_SECRET)`,
  // so a request with no Authorization header skipped the check and anyone could set off the reminder run. Mirrors the
  // guard in cron/process-email-outbox.js.
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron/check-subscription-expiry] CRON_SECRET is not set - refusing to run')
    return res.status(500).json({ error: 'Server misconfigured: CRON_SECRET not set' })
  }
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (token !== expected) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date()
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000)

  try {
    // When restrictions were switched on (carehub_20261214). Missing before that migration: then an expired plan gets
    // a plain "your plan has expired" reminder and nothing is said about restrictions.
    let enforcementStartedAt = null
    if (typeof supabase.rpc === 'function') {
      const { data, error } = await supabase.rpc('plan_enforcement_started_at')
      if (!error && data) enforcementStartedAt = data
    }

    // Every active main business expiring within the horizon or already expired. Branches follow their main business's
    // plan and have no email of their own (carehub_20261212_branches_without_email): the owner hears once, through it.
    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, name, plan, plan_expires_at, owner_name, owner_email, email, status')
      .lte('plan_expires_at', horizon.toISOString())
      .eq('status', 'active')
      .is('parent_business_id', null)
      .is('deleted_at', null)
    if (error) throw error

    const { EmailService, senderFor } = await import('@care-ecosystem/shared-email')
    const emailService = new EmailService()
    const carehubSender = senderFor('carehub')

    let enqueued = 0
    let skipped = 0
    let alreadySent = 0
    const stages = {}

    for (const biz of businesses || []) {
      const ownerEmail = biz.owner_email || biz.email
      const due = reminderStage({ expiresAt: biz.plan_expires_at, enforcementStartedAt, now })
      if (!ownerEmail || !due) { skipped++; continue }

      const expiryDate = fmtDate(biz.plan_expires_at)
      const { error: enqErr } = await supabase.from('email_outbox').insert({
        app: 'carehub',
        to_email: ownerEmail,
        from_email: carehubSender,
        subject: due.templateStage === 'restricted' ? 'Some CareHub features are paused'
          : due.daysLeft > 0 ? `Your CareHub plan expires in ${due.daysLeft} day${due.daysLeft === 1 ? '' : 's'}`
            : due.templateStage === 'grace_last' ? 'Renew today: CareHub restrictions start tomorrow'
              : 'Your CareHub plan has expired',
        template_key: 'subscription_expiry',
        idempotency_key: reminderKey(biz.id, biz.plan_expires_at, due.stage),
        payload: {
          fullName: biz.owner_name || 'Business Owner',
          plan: biz.plan ? biz.plan.charAt(0).toUpperCase() + biz.plan.slice(1) : 'CareHub',
          businessName: biz.name,
          expiryDate,
          daysLeft: due.daysLeft,
          stage: due.templateStage,
          graceEndDate: due.graceEndsAt ? fmtDate(due.graceEndsAt) : undefined,
        },
        status: 'pending',
        next_retry_at: now.toISOString(),
      })
      if (enqErr) {
        // 23505: this reminder was already queued (same business, plan period and stage).
        if (enqErr.code === '23505') alreadySent++
        else { skipped++; console.error('[cron/check-subscription-expiry] enqueue failed', biz.id, enqErr.message) }
        continue
      }
      enqueued++
      stages[due.templateStage] = (stages[due.templateStage] || 0) + 1
    }

    // Flush immediately so the daily outbox cron is only a retry fallback.
    emailService.processBatch().catch((err) => {
      console.error('[cron/check-subscription-expiry] flush failed', err)
    })

    console.info('[cron/check-subscription-expiry] done', { scanned: (businesses || []).length, enqueued, alreadySent, skipped, stages, enforcement: !!enforcementStartedAt })
    return res.status(200).json({ ok: true, scanned: (businesses || []).length, enqueued, alreadySent, skipped, stages })
  } catch (e) {
    console.error('[cron/check-subscription-expiry] failed', e)
    return res.status(500).json({ error: e.message })
  }
}
