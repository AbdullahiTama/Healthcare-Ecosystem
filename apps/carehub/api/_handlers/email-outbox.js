import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { status, templateKey, limit = 50, offset = 0 } = req.query
    let q = supabase.from('email_outbox').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1)
    if (status) q = q.eq('status', status)
    if (templateKey) q = q.eq('template_key', templateKey)
    const { data, error, count } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, emails: data, total: count })
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
