// EmailService — all heavy imports are deferred to first use to prevent
// module-level crashes in serverless environments where @supabase/supabase-js
// may not be resolvable at import time.

let _createClient = null
let _sendEmail = null
let _templates = null

async function deps() {
  if (!_sendEmail) {
    const mod = await import('./sendEmail.js')
    _sendEmail = mod.sendEmail
  }
  if (!_templates) {
    _templates = await import('./templates/index.js')
  }
  return { sendEmail: _sendEmail, getTemplate: _templates.getTemplate, TEMPLATE_REGISTRY: _templates.TEMPLATE_REGISTRY }
}

// supabase-js is loaded here and not from deps() because deps() is called on
// every processBatch(), including when the caller injected its own client via
// `new EmailService({ supabase })`. A bare '@supabase/supabase-js' specifier
// only resolves by walking up from this file, and on Vercel the workspace
// package is deployed without its own node_modules, so the lookup misses and
// the cron dies with "Cannot find package '@supabase/supabase-js'". Keeping
// it out of deps() means a service with an injected client never needs it.
async function loadCreateClient() {
  if (!_createClient) {
    const mod = await import('@supabase/supabase-js')
    _createClient = mod.createClient
  }
  return _createClient
}

// Each app sends from its own brand identity. The outbox row's from_email
// decides which app's template set renders it — both apps share one outbox
// table, so the choice must be per-row, not per-process.
export function resolveAppFromSender(fromEmail) {
  return fromEmail && String(fromEmail).includes('CareHub') ? 'carehub' : 'carefind'
}

// Payload keys that can carry a usable credential. A canary render replaces
// these so the canary inbox proves subject, branding and layout without ever
// holding a live password reset or verification link.
const SENSITIVE_PAYLOAD_KEY = /(link|token|otp|secret|password)/i
const REDACTED = '[redacted]'

// Recurses into plain objects but not arrays, so an items[] line never gets
// mangled while a nested links.reset still cannot leak.
export function redactPayload(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_PAYLOAD_KEY.test(k) ? REDACTED : redactPayload(v)
    }
    return out
  }
  return value
}

let _supabase = null
async function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    }
    const createClient = await loadCreateClient()
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  }
  return _supabase
}

export class EmailService {
  constructor(options = {}) {
    this._options = options
    this._db = options.supabase || null
    this.maxRetries = options.maxRetries ?? 5
    this.baseDelayMs = options.baseDelayMs ?? 60000
    this.batchSize = options.batchSize ?? 20
  }

  async _getDb() {
    if (!this._db) this._db = await getSupabase()
    return this._db
  }

  async enqueue({ templateKey, toEmail, payload, fromEmail, subject, app, eventKey }) {
    if (!templateKey || !toEmail) throw new Error('templateKey and toEmail are required')
    const db = await this._getDb()
    const from = fromEmail || (process.env.RESEND_FROM_EMAIL || 'CareHub <support@mail.carefindhub.com>')
    // app and event_key must always be populated. guard_email_outbox_quarantine()
    // is a BEFORE INSERT trigger that parks any row missing either of them:
    // it sets quarantine_reason='legacy_mapping_unproven' and
    // next_retry_at='infinity', so processBatch's `next_retry_at <= now` filter
    // never matches and the email is silently undeliverable. That is why every
    // legacy enqueue call site appeared to succeed while sending nothing.
    // The mapping is now explicit: the sender decides the app (same rule the
    // renderer uses) and the template key is the catalog event key.
    const { data, error } = await db
      .from('email_outbox')
      .insert({
        to_email: toEmail,
        from_email: from,
        subject: subject || '',
        template_key: templateKey,
        app: app || resolveAppFromSender(from),
        event_key: eventKey || templateKey,
        payload: payload || {},
        status: 'pending',
        next_retry_at: new Date().toISOString(),
      })
      .select().single()
    if (error) throw error
    await db.from('email_logs').insert({ outbox_id: data.id, event_type: 'enqueued', detail: `Queued template=${templateKey} to=${toEmail}` })
    return data
  }

  async _getSetting(key) {
    const db = await this._getDb()
    const { data, error } = await db
      .from('email_system_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    if (error) throw error
    return data?.value ?? null
  }

  async _isDispatchPaused() {
    return (await this._getSetting('dispatch_paused')) === true
  }

  async processBatch() {
    const { sendEmail, getTemplate } = await deps()
    const db = await this._getDb()

    // dispatch_paused is the documented rollback lever and it existed in the
    // schema with no code reading it. Honouring it here means business writes
    // keep enqueueing while nothing is claimed, so the queue drains intact the
    // moment the switch is turned back off.
    if (await this._isDispatchPaused()) {
      return { processed: 0, sent: 0, failed: 0, paused: true }
    }

    // Read once per batch. canary_recipient is deliberately unset by default:
    // an unset value is the fail-closed state, not a fallback to real delivery.
    const canaryRecipient = await this._getSetting('canary_recipient')
    const now = new Date().toISOString()
    const { data: batch, error } = await db
      .from('email_outbox').select('*').in('status', ['pending', 'failed']).lte('next_retry_at', now).lte('attempts', this.maxRetries).order('next_retry_at', { ascending: true }).limit(this.batchSize)
    if (error) throw error
    if (!batch || batch.length === 0) return { processed: 0, sent: 0, failed: 0 }

    let sent = 0, failed = 0
    for (const row of batch) {
      try {
        const app = resolveAppFromSender(row.from_email)
        const templateFn = getTemplate(row.template_key, app)
        // Fail closed. The old branch rendered '' and mailed an empty body, so
        // a missing renderer reached customers as a blank email with no error.
        if (!templateFn) {
          await this._markFailed(row.id, `no_template:${app}:${row.template_key}`)
          failed++
          continue
        }

        let to = row.to_email
        let payload = row.payload
        if (row.is_canary) {
          // Fail closed: a canary row must never reach its real recipient. If
          // there is no canary address the row fails and retries later rather
          // than being delivered to to_email.
          if (!canaryRecipient) {
            await this._markFailed(row.id, 'canary_recipient_unset')
            failed++
            continue
          }
          to = canaryRecipient
          // Strip tokens so a canary inbox never receives a usable action
          // link. The stored payload is left untouched for audit.
          payload = redactPayload(row.payload)
        }

        const html = templateFn(payload)
        const result = await sendEmail({ to, subject: row.subject, html, from: row.from_email })
        if (result.success) { await this._markSent(row.id, result.data); sent++ }
        else { await this._markFailed(row.id, result.error); failed++ }
      } catch (e) { await this._markFailed(row.id, e.message); failed++ }
    }
    return { processed: batch.length, sent, failed }
  }

  async _markSent(id, providerId) {
    const db = await this._getDb()
    await db.from('email_outbox').update({ status: 'sent', provider_id: providerId, sent_at: new Date().toISOString() }).eq('id', id)
    await db.from('email_logs').insert({ outbox_id: id, event_type: 'sent', detail: 'Delivered via Resend', metadata: { provider_id: providerId } })
  }

  async _markFailed(id, error) {
    const db = await this._getDb()
    const { data: row } = await db.from('email_outbox').select('attempts').eq('id', id).single()
    const newAttempts = (row?.attempts || 0) + 1
    const nextRetry = new Date(Date.now() + this.baseDelayMs * Math.pow(2, newAttempts - 1)).toISOString()
    const status = newAttempts >= this.maxRetries ? 'dead' : 'failed'
    await db.from('email_outbox').update({ status, attempts: newAttempts, last_error: error, next_retry_at: nextRetry }).eq('id', id)
    await db.from('email_logs').insert({ outbox_id: id, event_type: 'failed', detail: error, metadata: { attempts: newAttempts, next_retry_at: nextRetry } })
  }
}

let _emailService = null
// options.supabase lets the caller supply a client it already built, which
// skips loadCreateClient() entirely. The first caller's options win, so the
// singleton stays stable.
export function getEmailService(options = {}) {
  if (!_emailService) _emailService = new EmailService(options)
  return _emailService
}
