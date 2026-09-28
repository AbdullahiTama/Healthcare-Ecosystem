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

// crypto.randomUUID needs a secure context. Every current runtime has it, but
// a claim that silently reused one constant would let two workers both believe
// they own the same row, which is the exact bug this token exists to prevent.
function newClaimToken() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
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
    // How long a worker owns a claimed row. Long enough to cover one send, short
    // enough that a worker killed mid batch does not strand the row until the
    // next deploy. An expired claim is reclaimable by any worker.
    this.claimTtlMs = options.claimTtlMs ?? 120000
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

  // Take exclusive ownership of a row before sending it.
  //
  // The previous implementation selected pending rows and sent them, with no
  // write marking ownership. Two workers configured against the one outbox
  // table therefore both read the same row and both sent it, so a customer got
  // the same email twice. The claim is a conditional UPDATE: it only lands when
  // the row is still unowned or the previous owner's lease has expired, and
  // returning no row means somebody else won. toISOString() is used deliberately,
  // because a 'Z' suffix keeps the value safe inside a PostgREST or() filter,
  // where a '+' offset would be read as a space.
  async _claimRow(row, nowIso) {
    const db = await this._getDb()
    const token = newClaimToken()
    const { data, error } = await db
      .from('email_outbox')
      .update({
        claim_token: token,
        claimed_at: nowIso,
        claim_expires_at: new Date(Date.now() + this.claimTtlMs).toISOString(),
      })
      .eq('id', row.id)
      .in('status', ['pending', 'failed'])
      .or(`claim_token.is.null,claim_expires_at.lt.${nowIso}`)
      .select()
      .maybeSingle()
    if (error) throw error
    return data ? { ...data, claim_token: token } : null
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

    // The attempt ceiling is deliberately not part of this query. max_attempts
    // lives on the row, and PostgREST cannot compare one column against another,
    // so it is applied per row below. Filtering here on the service wide
    // maxRetries instead meant a row that was legitimately retried more times
    // than the service default could be picked up or dropped on the wrong side.
    const { data: candidates, error } = await db
      .from('email_outbox').select('*').in('status', ['pending', 'failed']).lte('next_retry_at', now).order('next_retry_at', { ascending: true }).limit(this.batchSize)
    if (error) throw error
    if (!candidates || candidates.length === 0) return { processed: 0, sent: 0, failed: 0 }

    let sent = 0, failed = 0, exhausted = 0, contended = 0
    for (const candidate of candidates) {
      // Exhausted rows are retired, not retried forever. This is also the
      // backstop for a row whose claim was released by a worker crash after it
      // had already burned every attempt.
      if ((candidate.attempts || 0) >= (candidate.max_attempts ?? this.maxRetries)) {
        exhausted++
        continue
      }

      let row
      try {
        row = await this._claimRow(candidate, now)
      } catch (e) {
        // A claim failure is not a send failure. Do not mark the row, because it
        // may still be owned by a healthy worker.
        contended++
        continue
      }
      if (!row) { contended++; continue }

      try {
        const app = resolveAppFromSender(row.from_email)
        const templateFn = getTemplate(row.template_key, app)
        // Fail closed. The old branch rendered '' and mailed an empty body, so
        // a missing renderer reached customers as a blank email with no error.
        if (!templateFn) {
          await this._markFailed(row, `no_template:${app}:${row.template_key}`)
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
            await this._markFailed(row, 'canary_recipient_unset')
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
        if (result.success) { await this._markSent(row, result.data); sent++ }
        else { await this._markFailed(row, result.error); failed++ }
      } catch (e) { await this._markFailed(row, e.message); failed++ }
    }
    return { processed: candidates.length, sent, failed, exhausted, contended }
  }

  // Both terminal writes are scoped to the claim token and clear it. Scoping is
  // what makes a slow worker harmless: if its lease expired and another worker
  // already took the row, the write matches nothing instead of overwriting a
  // newer attempt's status or double incrementing attempts.
  async _markSent(row, providerId) {
    const db = await this._getDb()
    const release = { claim_token: null, claimed_at: null, claim_expires_at: null }
    await db.from('email_outbox')
      .update({ status: 'sent', provider_id: providerId, sent_at: new Date().toISOString(), ...release })
      .eq('id', row.id).eq('claim_token', row.claim_token)
    await db.from('email_logs').insert({ outbox_id: row.id, event_type: 'sent', detail: 'Delivered via Resend', metadata: { provider_id: providerId } })
  }

  async _markFailed(row, error) {
    const db = await this._getDb()
    const limit = row.max_attempts ?? this.maxRetries
    const newAttempts = (row.attempts || 0) + 1
    const nextRetry = new Date(Date.now() + this.baseDelayMs * Math.pow(2, newAttempts - 1)).toISOString()
    const status = newAttempts >= limit ? 'dead' : 'failed'
    const release = { claim_token: null, claimed_at: null, claim_expires_at: null }
    await db.from('email_outbox')
      .update({ status, attempts: newAttempts, last_error: error, next_retry_at: nextRetry, ...release })
      .eq('id', row.id).eq('claim_token', row.claim_token)
    await db.from('email_logs').insert({ outbox_id: row.id, event_type: 'failed', detail: error, metadata: { attempts: newAttempts, next_retry_at: nextRetry } })
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
