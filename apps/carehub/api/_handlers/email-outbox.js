import { supabase } from '../_lib/supabase.js'
import { requirePlatformAdmin } from '../_lib/requirePlatformAdmin.js'

const MAX_LIMIT = 100
// What an operator may move a row to by hand: re-queue it, schedule a retry, or give up on it. Anything else (sent,
// bounced, complained ...) is a fact about delivery, not a decision.
const SETTABLE_STATUSES = ['pending', 'retrying', 'failed']

function toInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export default async function handler(req, res) {
  // This endpoint runs on the service-role client and returns every recipient and payload in the outbox (payloads
  // carry live password-reset and verification links), so the caller must be a platform admin. It used to accept any
  // non-empty bearer string without validating it.
  const { status: authStatus, error: authError } = await requirePlatformAdmin(req, supabase)
  if (authStatus) return res.status(authStatus).json({ error: authError })

  if (req.method === 'GET') {
    const { status, templateKey, app, startDate, endDate } = req.query
    const limit = toInt(req.query.limit, 50, 1, MAX_LIMIT)
    const offset = toInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER)

    // Build query with filters
    let q = supabase.from('email_outbox').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    if (status) q = q.eq('status', status)
    if (templateKey) q = q.eq('template_key', templateKey)
    if (app) q = q.eq('app', app)
    if (startDate) q = q.gte('created_at', startDate)
    if (endDate) q = q.lte('created_at', endDate)

    const { data, error, count } = await q
    if (error) return res.status(500).json({ error: error.message })

    // Also compute aggregated metrics
    let metrics = {}
    if (count > 0) {
      const statuses = ['pending', 'processing', 'sent', 'failed', 'bounced', 'complained', 'dead']
      const statusBreakdown = {}
      for (const s of statuses) {
        const { count: c } = await supabase.from('email_outbox').select('*', { count: 'exact' }).eq('status', s)
        statusBreakdown[s] = c || 0
      }
      metrics = {
        total: count,
        statusBreakdown,
        pending: statusBreakdown.pending || 0,
        processing: statusBreakdown.processing || 0,
        sent: statusBreakdown.sent || 0,
        failed: statusBreakdown.failed || 0,
        bounced: statusBreakdown.bounced || 0,
        complained: statusBreakdown.complained || 0,
      }
    }

    return res.status(200).json({ ok: true, emails: data, total: count, metrics })
  }

  if (req.method === 'POST') {
    const { id, status: newStatus } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id required' })
    if (!SETTABLE_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: `status must be one of: ${SETTABLE_STATUSES.join(', ')}` })
    }
    const { data, error } = await supabase.from('email_outbox').update({ status: newStatus, next_retry_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, outboxId: data.id })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
