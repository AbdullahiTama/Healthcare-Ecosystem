import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
