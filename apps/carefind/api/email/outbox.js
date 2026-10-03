import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Admin authorization: require active admin session
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  // In production, validate token against supabase.auth.getUser(token)
  // For now, we accept any valid bearer token for this dashboard endpoint
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized - missing bearer token' })
  }

  if (req.method === 'GET') {
    const { status, templateKey, app, startDate, endDate, limit = 50, offset = 0 } = req.query

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
      // Get status breakdown
      const statuses = ['pending', 'processing', 'sent', 'failed', 'bounced', 'complained', 'dead']
      let statusBreakdown = {}
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
    const { data, error } = await supabase.from('email_outbox').update({ status: newStatus, next_retry_at: new Date().toISOString() }).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, outboxId: data.id })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}