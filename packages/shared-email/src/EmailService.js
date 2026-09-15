import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './sendEmail.js'
import { TEMPLATE_REGISTRY } from './templates/index.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export class EmailService {
  constructor(options = {}) {
    this.db = options.supabase || supabase
    this.maxRetries = options.maxRetries ?? 5
    this.baseDelayMs = options.baseDelayMs ?? 60000
    this.batchSize = options.batchSize ?? 20
  }

  async enqueue({ templateKey, toEmail, payload, fromEmail, subject }) {
    if (!templateKey || !toEmail) throw new Error('templateKey and toEmail are required')
    const { data, error } = await this.db
      .from('email_outbox')
      .insert({ to_email: toEmail, from_email: fromEmail || (process.env.RESEND_FROM_EMAIL || 'CareHub <support@carehub.ng>'), subject: subject || '', template_key: templateKey, payload: payload || {}, status: 'pending', next_retry_at: new Date().toISOString() })
      .select().single()
    if (error) throw error
    await this.db.from('email_logs').insert({ outbox_id: data.id, event_type: 'enqueued', detail: `Queued template=${templateKey} to=${toEmail}` })
    return data
  }

  async processBatch() {
    const now = new Date().toISOString()
    const { data: batch, error } = await this.db
      .from('email_outbox').select('*').in('status', ['pending', 'failed']).lte('next_retry_at', now).lte('attempts', this.maxRetries).order('next_retry_at', { ascending: true }).limit(this.batchSize)
    if (error) throw error
    if (!batch || batch.length === 0) return { processed: 0, sent: 0, failed: 0 }

    let sent = 0, failed = 0
    for (const row of batch) {
      try {
        const templateFn = TEMPLATE_REGISTRY[row.template_key]
        const html = templateFn ? templateFn(row.payload) : ''
        const result = await sendEmail({ to: row.to_email, subject: row.subject, html })
        if (result.success) { await this._markSent(row.id, result.data); sent++ }
        else { await this._markFailed(row.id, result.error); failed++ }
      } catch (e) { await this._markFailed(row.id, e.message); failed++ }
    }
    return { processed: batch.length, sent, failed }
  }

  async _markSent(id, providerId) {
    await this.db.from('email_outbox').update({ status: 'sent', provider_id: providerId, sent_at: new Date().toISOString() }).eq('id', id)
    await this.db.from('email_logs').insert({ outbox_id: id, event_type: 'sent', detail: 'Delivered via Resend', metadata: { provider_id: providerId } })
  }

  async _markFailed(id, error) {
    const { data: row } = await this.db.from('email_outbox').select('attempts').eq('id', id).single()
    const newAttempts = (row?.attempts || 0) + 1
    const nextRetry = new Date(Date.now() + this.baseDelayMs * Math.pow(2, newAttempts - 1)).toISOString()
    const status = newAttempts >= this.maxRetries ? 'dead' : 'failed'
    await this.db.from('email_outbox').update({ status, attempts: newAttempts, last_error: error, next_retry_at: nextRetry }).eq('id', id)
    await this.db.from('email_logs').insert({ outbox_id: id, event_type: 'failed', detail: error, metadata: { attempts: newAttempts, next_retry_at: nextRetry } })
  }
}

export const emailService = new EmailService()
