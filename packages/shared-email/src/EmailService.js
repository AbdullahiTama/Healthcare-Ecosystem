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

import { htmlToText } from './utils/htmlToText.js'

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

// True when a credential-bearing key has already been scrubbed (see _markSent). Such a row can no longer be rendered
// into a usable email, so it must not be sent again.
export function isScrubbed(value) {
  if (Array.isArray(value) || !value || typeof value !== 'object') return false
  return Object.entries(value).some(([k, v]) => (SENSITIVE_PAYLOAD_KEY.test(k) ? v === REDACTED : isScrubbed(v)))
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

// An env var is operator input, not a trusted number. Anything unparseable or
// out of range falls back to the default instead of silently producing a
// zero-row batch or a batch large enough to time the function out.
export function boundedInt(raw, fallback, min, max) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

// Correlates every log line and email_logs insert with a request ID so operators
// can trace a complete end-to-end flow from API request → worker → provider → DB.
// Falls back to a deterministic per-process ID when none is supplied.
let requestId = globalThis.crypto?.randomUUID?.() || 'worker-' + Date.now()

// Structured, single line, no addresses and no rendered content. Correlating by
// outbox row id is enough to trace a send; the recipient and the payload stay
// in the database where they are access controlled.
function logEvent(event, fields = {}) {
  // Mask any recipient address that may have leaked into fields
  const safeFields = redactSensitiveFields(fields)
  console.log(
    JSON.stringify({
      component: 'email-outbox',
      event,
      request_id: requestId,
      at: new Date().toISOString(),
      ...safeFields,
    })
  )
}

// Remove any value that looks like an email address or a token from log output.
// Arrays are handled recursively; plain values that match an email-like pattern
// or common secret pattern are replaced with '[redacted]'.
function redactSensitiveFields(fields) {
  const redact = (value) => {
    if (value === null || value === undefined) return value
    if (Array.isArray(value)) return value.map(redact)
    if (typeof value === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = redact(v)
      }
      return out
    }
    const s = String(value)
    // Email-like patterns
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(s)) return '[redacted]'
    // Common secret/token patterns
    if (/[a-zA-Z0-9]{20,}/.test(s)) return '[redacted]'
    if (s.includes('otp=') || s.includes('token=') || s.includes('secret=')) return '[redacted]'
    return s
  }
  if (Array.isArray(fields)) return fields.map(redactSensitiveFields)
  if (typeof fields === 'object' && fields !== null) {
    const out = {}
    for (const [k, v] of Object.entries(fields)) {
      out[k] = redactSensitiveFields(v)
    }
    return out
  }
  return fields
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
    // Batch size is the single knob that bounds one cron invocation's blast
    // radius: rows claimed, provider calls made, and the runtime the serverless
    // function may burn before it is killed. Env so an operator can lower it
    // without a deploy, default so it cannot be left unbounded.
    this.batchSize = options.batchSize ?? boundedInt(process.env.EMAIL_OUTBOX_BATCH_SIZE, 20, 1, 100)
    // How long a worker owns a claimed row. Long enough to cover one send, short
    // enough that a worker killed mid batch does not strand the row until the
    // next deploy. An expired claim is reclaimable by any worker.
    this.claimTtlMs = options.claimTtlMs ?? 120000
    // A serverless function has a hard wall-clock limit (the platform default is about 10s) and a drain is up to
    // batchSize x maxBatches sequential sends. Stop CLAIMING new rows once this budget is spent so the function
    // finishes on its own terms: being killed mid-send leaves a row that was mailed but never acknowledged.
    this.timeBudgetMs = options.timeBudgetMs ?? boundedInt(process.env.EMAIL_OUTBOX_TIME_BUDGET_MS, 8000, 1000, 250000)
    // How long a bounced address is left alone. A complaint never expires; a bounce does, because "mailbox full" and
    // "address does not exist" arrive as the same status and only the second is permanent.
    this.bounceSuppressDays = options.bounceSuppressDays ?? boundedInt(process.env.EMAIL_BOUNCE_SUPPRESS_DAYS, 30, 1, 3650)
    // Pause between attempts to record an outcome (see _release); 0 in tests.
    this.writeRetryDelayMs = options.writeRetryDelayMs ?? 100

    // Observability metrics (in-process, process-local; persisted via email_logs)
    this.metrics = {
      queued: 0,
      sent: 0,
      delivered: 0, // same as sent at worker level; provider-delivered tracked by webhook
      failed: 0,
      bounced: 0,
      complained: 0,
      retryCount: 0, // total retry attempts across all rows
      sendLatencyMs: 0, // sum of latencies for average
      sendCount: 0, // count for average
      rowsProcessed: 0,
      rowsFailed: 0,
      rowsRetrying: 0,
    }
    // Per-row state: attempts, status, provider message id, timestamps
    this.rowState = new Map() // id -> { attempts, status, providerMessageId, createdAt, sentAt, deliveredAt }
    // Request ID from the invoking cron/handler (overrides module-level default)
    this.requestId = options.requestId || globalThis._cronRequestId || globalThis.crypto?.randomUUID?.() || 'worker-' + Date.now()
  }

  async _getDb() {
    if (!this._db) this._db = await getSupabase()
    return this._db
  }

  async enqueue({ templateKey, toEmail, payload, fromEmail, subject, app, eventKey, sourceId, idempotencyKey }) {
    if (!templateKey || !toEmail) throw new Error('templateKey and toEmail are required')
    const db = await this._getDb()
    const from = fromEmail || (process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || '')
    if (!from) throw new Error('EMAIL_FROM is not configured')
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
        source_id: sourceId || null,
        idempotency_key: idempotencyKey || null,
        payload: payload || {},
        status: 'pending',
        next_retry_at: new Date().toISOString(),
      })
      .select().single()
    if (error) {
      // A deterministic event_key means this exact event was already queued
      // (refresh, webhook replay, retry). Surface the original row rather
      // than enqueueing a duplicate.
      if (error.code === '23505') {
        let q = db.from('email_outbox').select('*').eq('app', app || resolveAppFromSender(from))
        if (idempotencyKey) q = q.eq('idempotency_key', idempotencyKey)
        else q = q.eq('event_key', eventKey || templateKey).eq('source_id', sourceId || null)
        const { data: existing } = await q.limit(1).maybeSingle()
        if (existing) return { ...existing, deduplicated: true }
      }
      throw error
    }
    await db.from('email_logs').insert({ outbox_id: data.id, event_type: 'enqueued', detail: `Queued template=${templateKey}`, metadata: { request_id: this.requestId, app: app || resolveAppFromSender(from), template_key: templateKey } })
    this.metrics.queued++
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
  //
  // The attempt is counted HERE, at claim time, not after the send. A row that hangs or crashes the worker is never
  // released, so counting only on release meant its attempts never advanced and it was reclaimed forever. The write is
  // conditional on the attempts value that was read, so a candidate that went stale (another worker claimed and
  // released it in between) is contended instead of silently losing an increment.
  async _claimRow(row, nowIso) {
    const db = await this._getDb()
    const token = newClaimToken()
    const attempts = row.attempts || 0
    const { data, error } = await db
      .from('email_outbox')
      .update({
        status: 'processing',
        attempts: attempts + 1,
        claim_token: token,
        claimed_at: nowIso,
        claim_expires_at: new Date(Date.now() + this.claimTtlMs).toISOString(),
      })
      .eq('id', row.id)
      .eq('attempts', attempts)
      .in('status', ['pending', 'retrying', 'processing'])
      .or(`claim_token.is.null,claim_expires_at.lt.${nowIso}`)
      .select()
      .maybeSingle()
    if (error) throw error
    return data ? { ...data, claim_token: token } : null
  }

  // `startedAt` lets drain() share one budget across its batches.
  async processBatch({ startedAt = Date.now() } = {}) {
    const { sendEmail, getTemplate } = await deps()
    const db = await this._getDb()
    // Every log line of this run carries the invoking request's id (see logEvent).
    requestId = this.requestId

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
      .from('email_outbox').select('*').in('status', ['pending', 'retrying', 'processing']).lte('next_retry_at', now).order('next_retry_at', { ascending: true }).limit(this.batchSize)
    if (error) throw error
    if (!candidates || candidates.length === 0) return { processed: 0, sent: 0, failed: 0 }

    const suppressed = await this._suppressedRecipients(candidates.map((c) => c.to_email))

    let sent = 0, failed = 0, retrying = 0, exhausted = 0, contended = 0, handled = 0
    for (const candidate of candidates) {
      // Out of time: leave the rest pending for the next run rather than risk being killed mid-send.
      if (Date.now() - startedAt > this.timeBudgetMs) {
        logEvent('time_budget_reached', { budget_ms: this.timeBudgetMs, left: candidates.length - handled })
        break
      }
      handled++
      // Exhausted rows are retired, not retried forever. This is also the
      // backstop for a row whose claim was released by a worker crash after it
      // had already burned every attempt.
      if ((candidate.attempts || 0) >= (candidate.max_attempts ?? this.maxRetries)) {
        exhausted++
        try { await this._markFailedById(candidate) } catch (e) { /* row may have been claimed concurrently */ }
        logEvent('row_exhausted', { row: candidate.id, attempts: candidate.attempts, max_attempts: candidate.max_attempts })
        continue
      }

      let row
      try {
        row = await this._claimRow(candidate, now)
      } catch (e) {
        // A claim failure is not a send failure. Do not mark the row, because it
        // may still be owned by a healthy worker.
        contended++
        logEvent('claim_error', { row: candidate.id, error: e.message })
        continue
      }
      // A null claim means either another worker won the row or a live processing
      // lease still belongs to someone else. Either way, not ours to send.
      if (!row) { contended++; logEvent('row_contended', { row: candidate.id }); continue }

      try {
        const app = resolveAppFromSender(row.from_email)
        const templateFn = getTemplate(row.template_key, app)
        // Fail closed. The old branch rendered '' and mailed an empty body, so
        // a missing renderer reached customers as a blank email with no error.
        if (!templateFn) {
          await this._markFailed(row, `no_template:${app}:${row.template_key}`)
          failed++
          logEvent('send_failed_permanent', { row: row.id, reason: 'no_template', app, template: row.template_key })
          continue
        }

        // A sent row has its action link scrubbed. If one is queued again (an operator re-queues it), mailing it would
        // deliver a link that reads "[redacted]"; fail it so the sender is asked for a fresh email instead.
        if (isScrubbed(row.payload)) {
          await this._markFailed(row, 'payload_scrubbed')
          failed++
          logEvent('send_failed_permanent', { row: row.id, reason: 'payload_scrubbed' })
          continue
        }

        // A canary row goes to the canary inbox, so the real recipient's history does not apply to it.
        if (!row.is_canary && suppressed.has(String(row.to_email || '').toLowerCase())) {
          await this._markFailed(row, 'recipient_suppressed')
          failed++
          logEvent('send_failed_permanent', { row: row.id, reason: 'recipient_suppressed' })
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
            logEvent('send_failed_permanent', { row: row.id, reason: 'canary_recipient_unset' })
            continue
          }
          to = canaryRecipient
          // Strip tokens so a canary inbox never receives a usable action
          // link. The stored payload is left untouched for audit.
          payload = redactPayload(row.payload)
        }

        const html = templateFn(payload)
        // The row id is the idempotency key: if this row is ever sent again (the process died after the provider
        // accepted it, or the outcome could not be recorded) the provider collapses it into the original.
        const result = await sendEmail({ to, subject: row.subject, html, text: htmlToText(html), from: row.from_email, idempotencyKey: row.id })
        if (result.success) {
          await this._markSent(row, result.data)
          sent++
          logEvent('send_ok', { row: row.id, app, template: row.template_key, attempt: row.attempts || 0 })
        } else {
          const retryable = result.retryable === true || /429|timeout|network|econn|fetch failed/i.test(String(result.error || ''))
          if (retryable && (row.attempts || 0) < (row.max_attempts ?? this.maxRetries)) {
            const next = await this._markRetrying(row, result)
            retrying++
            failed++
            logEvent('send_retry_scheduled', { row: row.id, status: result.statusCode ?? null, attempt: row.attempts || 0, next_retry_at: next, retry_after_ms: result.retryAfterMs ?? null })
          } else {
            await this._markFailed(row, result.error || 'send failed')
            failed++
            logEvent('send_failed_permanent', { row: row.id, status: result.statusCode ?? null, attempt: row.attempts || 0, reason: retryable ? 'attempts_exhausted' : 'permanent' })
          }
        }
      } catch (e) {
        if ((row.attempts || 0) < (row.max_attempts ?? this.maxRetries)) {
          const next = await this._markRetrying(row, { error: e.message, retryable: true })
          retrying++
          failed++
          logEvent('send_retry_scheduled', { row: row.id, error: e.message, next_retry_at: next })
        } else {
          await this._markFailed(row, e.message)
          failed++
          logEvent('send_failed_permanent', { row: row.id, error: e.message, reason: 'attempts_exhausted' })
        }
      }
    }
    logEvent('batch_complete', { batch_size: this.batchSize, claimed: handled, sent, retrying, failed, exhausted, contended })
    return { processed: handled, sent, failed, retrying, exhausted, contended }
  }

  // Drain in bounded batches. One cron tick on a cold queue must not be limited
  // to a single batch, but a serverless function must also not run unbounded, so
  // the loop is capped by maxBatches as well as the per batch size.
  async drain(options = {}) {
    const maxBatches = options.maxBatches ?? boundedInt(process.env.EMAIL_OUTBOX_MAX_BATCHES, 4, 1, 20)
    const totals = { processed: 0, sent: 0, failed: 0, retrying: 0, exhausted: 0, contended: 0, batches: 0, paused: false }
    const startedAt = Date.now()
    for (let i = 0; i < maxBatches; i++) {
      if (Date.now() - startedAt > this.timeBudgetMs) break
      const r = await this.processBatch({ startedAt })
      if (r.paused) { totals.paused = true; return totals }
      // The final empty probe is not work. Counting it would report batches
      // that never claimed a row.
      if (!r.processed) break
      totals.batches++
      totals.processed += r.processed || 0
      totals.sent += r.sent || 0
      totals.failed += r.failed || 0
      totals.retrying += r.retrying || 0
      totals.exhausted += r.exhausted || 0
      totals.contended += r.contended || 0
      if (!r.processed) break
    }
    return totals
  }

  // Records what happened to a claimed row. The write is scoped to the claim token and clears it. Scoping is what makes
  // a slow worker harmless: if its lease expired and another worker already took the row, the write matches nothing
  // instead of overwriting a newer attempt's status.
  //
  // Supabase reports a failed write in { error } rather than throwing, and this used to ignore it: a database blip
  // right after a successful send left the row claimed, so after the lease it was sent AGAIN. The write is now
  // retried, a lost lease is reported, and a write that cannot be made is logged loudly (the row then stays claimed and
  // is re-sent after the lease, which the idempotency key makes harmless).
  async _release(row, patch, outcome) {
    const db = await this._getDb()
    const release = { claim_token: null, claimed_at: null, claim_expires_at: null }
    let lastError = null
    for (let i = 0; i < 3; i++) {
      const { data, error } = await db.from('email_outbox')
        .update({ ...patch, ...release })
        .eq('id', row.id)
        .eq('claim_token', row.claim_token)
        .select('id')
      if (!error) {
        if (!data || data.length === 0) {
          logEvent('lease_lost', { row: row.id, outcome })
          return false
        }
        return true
      }
      lastError = error
      if (i < 2 && this.writeRetryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.writeRetryDelayMs * (i + 1)))
    }
    logEvent('state_write_failed', { row: row.id, outcome, error: lastError && lastError.message })
    return false
  }

  async _markSent(row, providerData) {
    const db = await this._getDb()
    // Resend returns { id }, but the wrapper is also injected in tests and older
    // call sites pass a bare id. Storing the raw object here wrote the literal
    // string "[object Object]" into a text column and broke every later correlation
    // against the provider message id.
    const providerId = typeof providerData === 'string'
      ? providerData
      : providerData && (providerData.id || providerData.message_id || providerData.messageId)
    // The email is out, so the live action link (password reset, verification, staff setup) has no further use in the
    // database, where anyone able to read the outbox could use it until it expires. Only credential-bearing keys are
    // replaced; the rest of the payload stays for audit.
    await this._release(row, { status: 'sent', provider_id: providerId ?? null, provider_message_id: providerId ?? null, sent_at: new Date().toISOString(), payload: redactPayload(row.payload) }, 'sent')
    await this.rowState.set(row.id, {
      attempts: row.attempts || 0,
      status: 'sent',
      providerMessageId: providerId,
      createdAt: row.created_at,
      sentAt: new Date().toISOString(),
    })
    this.metrics.sent++
    this.metrics.rowsProcessed++
    // Emit structured log with required fields
    logEvent('send_ok', {
      event_type: 'sent',
      email_outbox_id: row.id,
      entity_id: row.entity_id || null,
      recipient_domain: row.to_email ? row.to_email.split('@').pop() || null : null,
      attempt_count: this.rowState.get(row.id)?.attempts || 0,
      status: 'sent',
      provider_message_id: providerId ?? null,
      latency_ms: new Date().getTime() - new Date(row.created_at).getTime(),
      error_category: null,
      retry_count: (row.attempts || 0),
      created_timestamp: row.created_at,
      sent_timestamp: new Date().toISOString(),
      delivery_timestamp: new Date().toISOString(),
      metadata: {
        request_id: this.requestId,
        app: row.app,
        template_key: row.template_key,
        provider_id: providerId ?? null,
      },
    })
  }

  // Retires a row that has used every attempt without being claimed. This includes a row stuck in `processing` whose
  // lease has expired (the worker that owned it hung or died): it can only reach its ceiling through claims now that the
  // attempt is counted at claim time, and without this it was reclaimed forever. A LIVE lease is left alone, because its
  // owner may still be sending.
  async _markFailedById(candidate) {
    const db = await this._getDb()
    await db.from('email_outbox')
      .update({ status: 'failed', last_error: 'max attempts reached' })
      .eq('id', candidate.id)
      .in('status', ['pending', 'retrying', 'processing'])
      .or(`claim_token.is.null,claim_expires_at.lt.${new Date().toISOString()}`)
  }

  // Lower-cased addresses, among `emails`, that must not be mailed: one that reported an earlier email as spam, or one
  // that bounced within bounceSuppressDays. The list is the outbox's own history as written by the Resend webhook, so
  // there is no second table to keep in step with it. Fails open: if the history cannot be read the batch is sent as
  // before, because a database hiccup must not stop a password reset.
  async _suppressedRecipients(emails) {
    const wanted = new Set()
    for (const email of emails) {
      if (typeof email !== 'string' || !email) continue
      wanted.add(email)
      wanted.add(email.toLowerCase())
    }
    const suppressed = new Set()
    if (wanted.size === 0) return suppressed
    try {
      const db = await this._getDb()
      const { data, error } = await db
        .from('email_outbox').select('to_email, status, bounced_at, is_canary').in('to_email', [...wanted]).in('status', ['bounced', 'complained'])
      if (error) throw error
      const cutoff = Date.now() - this.bounceSuppressDays * 86400000
      for (const past of data || []) {
        // A canary row was mailed to the canary inbox, so its bounce says nothing about to_email.
        if (past.is_canary) continue
        const bouncedAt = Date.parse(past.bounced_at)
        if (past.status === 'complained' || Number.isNaN(bouncedAt) || bouncedAt >= cutoff) suppressed.add(String(past.to_email).toLowerCase())
      }
    } catch (e) {
      logEvent('suppression_check_failed', { error: e?.message || String(e) })
      return new Set()
    }
    return suppressed
  }

  async _markFailed(row, error) {
    const db = await this._getDb()
    // The attempt was already counted when the row was claimed.
    const newAttempts = row.attempts || 0
    await this._release(row, { status: 'failed', attempts: newAttempts, last_error: String(error || '').slice(0, 500), failed_at: new Date().toISOString() }, 'failed')
    await this.rowState.set(row.id, {
      attempts: newAttempts,
      status: 'failed',
      providerMessageId: row.provider_message_id || null,
      createdAt: row.created_at,
      sentAt: null,
      deliveredAt: null,
    })
    this.metrics.failed++
    this.metrics.rowsFailed++
    // Emit structured log with required fields
    const errorCategory = /^4\d{2}$/.test(String(row.last_error || error)) ? 'permanent' : 'retryable'
    logEvent('send_failed_permanent', {
      event_type: 'failed',
      email_outbox_id: row.id,
      entity_id: row.entity_id || null,
      recipient_domain: row.to_email ? row.to_email.split('@').pop() || null : null,
      attempt_count: newAttempts,
      status: 'failed',
      provider_message_id: row.provider_message_id || null,
      latency_ms: new Date().getTime() - new Date(row.created_at).getTime(),
      error_category: errorCategory,
      retry_count: newAttempts,
      created_timestamp: row.created_at,
      sent_timestamp: null,
      delivery_timestamp: null,
      metadata: {
        request_id: this.requestId,
        app: row.app,
        last_error: row.last_error || error,
        error_code: String(row.last_error || error).match(/^\d{3}/) ? String(row.last_error || error).substring(0, 3) : null,
      },
    })
  }

  // 1m / 5m / 15m / 1h / 6h / 24h. 429 Retry-After takes the larger of the two so
  // a rate limit is never retried into, and never longer than the last rung, so
  // a row can still not be parked beyond a day.
  static BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000]
  _nextRetryDelayMs(attempts, retryAfterMs) {
    const idx = Math.max(0, Math.min(attempts - 1, EmailService.BACKOFF_MS.length - 1))
    const base = EmailService.BACKOFF_MS[idx]
    const ceiling = EmailService.BACKOFF_MS[EmailService.BACKOFF_MS.length - 1]
    return Math.min(Math.max(base, Number.isFinite(retryAfterMs) ? retryAfterMs : 0), ceiling)
  }

  async _markRetrying(row, result) {
    const db = await this._getDb()
    // The attempt was already counted when the row was claimed.
    const newAttempts = row.attempts || 0
    const delay = this._nextRetryDelayMs(newAttempts, result && result.retryAfterMs)
    const nextRetry = new Date(Date.now() + delay).toISOString()
    // scheduled_at mirrors the next attempt time so the row reads the same
    // whether an operator or the worker looks at it.
    await this._release(row, { status: 'retrying', attempts: newAttempts, last_error: String((result && result.error) || '').slice(0, 500), next_retry_at: nextRetry, scheduled_at: nextRetry }, 'retrying')
    await this.rowState.set(row.id, {
      attempts: newAttempts,
      status: 'retrying',
      providerMessageId: row.provider_message_id || null,
      createdAt: row.created_at,
      sentAt: null,
      deliveredAt: null,
    })
    this.metrics.retryCount += newAttempts
    this.metrics.rowsRetrying++
    // Emit structured log with required fields
    logEvent('send_retry_scheduled', {
      event_type: 'failed', // reuse failed event type for retry scheduling
      email_outbox_id: row.id,
      entity_id: row.entity_id || null,
      recipient_domain: row.to_email ? row.to_email.split('@').pop() || null : null,
      attempt_count: newAttempts,
      status: 'retrying',
      provider_message_id: row.provider_message_id || null,
      latency_ms: new Date().getTime() - new Date(row.created_at).getTime(),
      error_category: result && result.retryable ? 'retryable' : 'permanent',
      retry_count: newAttempts,
      created_timestamp: row.created_at,
      sent_timestamp: null,
      delivery_timestamp: null,
      metadata: {
        request_id: this.requestId,
        app: row.app,
        next_retry_at: nextRetry,
        retry_after_ms: result && result.retryAfterMs,
      },
    })
    return nextRetry
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
