import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'crypto'

// Verify Resend webhook signature
function verifyWebhookSignature(req) {
  const signature = req.headers['x-resend-signature']
  if (!signature) return false

  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[webhooks/resend] RESEND_WEBHOOK_SECRET not set, skipping verification')
    return true // Allow in dev if secret not configured
  }

  const body = JSON.stringify(req.body)
  const expectedSignature = createHmac('sha256', secret).update(body).digest('hex')

  try {
    const sigBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expectedSignature)
    return sigBuffer.length === expectedBuffer.length && timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
  }

  // Verify webhook signature
  if (!verifyWebhookSignature(req)) {
    console.error('[webhooks/resend] Invalid signature')
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const event = req.body
  const { type, data } = event

  if (type === 'email.bounced' || type === 'email.complained') {
    const outboxId = data?.message?.id
    if (outboxId) {
      await supabase.from('email_outbox').update({
        status: type === 'email.complained' ? 'complained' : 'bounced',
        [type === 'email.complained' ? 'complained_at' : 'bounced_at']: new Date().toISOString(),
      }).eq('id', outboxId)
      await supabase.from('email_logs').insert({
        outbox_id: outboxId,
        event_type: type === 'email.complained' ? 'complained' : 'bounced',
        detail: `${type} event from Resend`,
        metadata: data,
      })
    }
  }

  if (type === 'email.opened') {
    const outboxId = data?.message?.id
    if (outboxId) {
      await supabase.from('email_outbox').update({ opened_at: new Date().toISOString() }).eq('id', outboxId)
    }
  }

  return res.status(200).json({ ok: true })
}
