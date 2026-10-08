// Resend webhook handling shared by CareFind and CareHub: signature verification and event application.
//
// Resend signs webhooks with Svix. Headers: svix-id, svix-timestamp, svix-signature ("v1,<base64>", several separated
// by spaces while a secret is rotated). The signature is HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, keyed with
// the base64-decoded part of the `whsec_...` secret. It covers the EXACT bytes received, so the caller must pass the raw
// body, never a re-serialised parsed one.
import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_TOLERANCE_SECONDS = 5 * 60

function header(headers, name) {
  const h = headers || {}
  const value = h[name] ?? h[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

// Resolves to { ok: true } or { ok: false, reason } where reason is one of
// secret_not_configured | missing_headers | timestamp_outside_tolerance | invalid_signature.
export function verifySvixSignature({ rawBody, headers, secret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: 'secret_not_configured' }

  const id = header(headers, 'svix-id')
  const timestamp = header(headers, 'svix-timestamp')
  const signatures = header(headers, 'svix-signature')
  if (!id || !timestamp || !signatures) return { ok: false, reason: 'missing_headers' }

  // The timestamp bounds how long a captured delivery stays replayable.
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp_outside_tolerance' }
  }

  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64')
  const hmac = createHmac('sha256', key)
  hmac.update(`${id}.${timestamp}.`)
  hmac.update(Buffer.isBuffer(rawBody) ? rawBody : String(rawBody ?? ''))
  const expected = hmac.digest()

  // Any one valid signature is enough: during a rotation Resend sends the old and the new.
  for (const part of String(signatures).split(' ')) {
    const [version, signature] = part.split(',')
    if (version !== 'v1' || !signature) continue
    const provided = Buffer.from(signature, 'base64')
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return { ok: true }
  }
  return { ok: false, reason: 'invalid_signature' }
}

// What each event type does to the outbox row. Statuses only move forward: a complaint is never downgraded to a
// bounce, and delivery / open only ever stamp a timestamp (once).
const OUTBOX_EFFECTS = {
  'email.bounced': { patch: (at) => ({ status: 'bounced', bounced_at: at }), fromStatuses: ['sent', 'bounced'] },
  'email.complained': { patch: (at) => ({ status: 'complained', complained_at: at }), fromStatuses: ['sent', 'bounced', 'complained'] },
  'email.delivered': { patch: (at) => ({ delivered_at: at }), onlyIfNull: 'delivered_at' },
  'email.opened': { patch: (at) => ({ opened_at: at }), onlyIfNull: 'opened_at' },
}

function validIso(value) {
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// Stored with the event: enough to understand a bounce, never the recipient address or any free text from the provider
// (a bounce message routinely repeats the address).
function safeMetadata(event) {
  const data = event?.data || {}
  const to = Array.isArray(data.to) ? data.to[0] : data.to
  const meta = {}
  if (data.bounce?.type) meta.bounce_type = String(data.bounce.type)
  if (data.bounce?.subType) meta.bounce_sub_type = String(data.bounce.subType)
  if (typeof to === 'string' && to.includes('@')) meta.to_domain = to.split('@').pop().toLowerCase()
  return meta
}

// Records a verified Resend event and applies it to the outbox. Idempotent on the Svix event id: a redelivery of an
// event that was applied is a no-op, and one that was recorded but not applied (a failure part-way) is applied now.
// Throws on a database error so the caller answers 5xx and Resend redelivers; resolves to
// { status: 'applied' | 'duplicate' | 'unmatched' | 'ignored' } otherwise.
export async function applyResendEvent(db, { svixId, event } = {}) {
  const type = String(event?.type || '')
  const emailId = event?.data?.email_id
  if (!svixId || !type || !emailId) return { status: 'ignored' }

  const receivedAt = new Date().toISOString()
  const at = validIso(event.created_at) || receivedAt

  // 1. Record. The unique provider_event_id is what makes this idempotent.
  let eventId
  const { data: inserted, error: insertError } = await db
    .from('email_provider_events')
    .insert({ provider_event_id: svixId, provider_message_id: emailId, event_type: type, safe_metadata: safeMetadata(event), received_at: receivedAt })
    .select('id')
    .maybeSingle()
  if (insertError) {
    if (insertError.code !== '23505') throw insertError
    const { data: existing, error: lookupError } = await db
      .from('email_provider_events')
      .select('id, applied_at')
      .eq('provider_event_id', svixId)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (existing?.applied_at) return { status: 'duplicate' }
    eventId = existing?.id
  } else {
    eventId = inserted?.id
  }

  const finish = async (patch) => {
    if (!eventId) return
    const { error } = await db.from('email_provider_events').update(patch).eq('id', eventId)
    if (error) throw error
  }

  // 2. Match by the PROVIDER's message id (outbox.provider_message_id), not the outbox's own id.
  const { data: row, error: rowError } = await db.from('email_outbox').select('id, status').eq('provider_message_id', emailId).maybeSingle()
  if (rowError) throw rowError
  if (!row) {
    await finish({ applied_at: new Date().toISOString(), apply_error: 'no_outbox_row' })
    return { status: 'unmatched' }
  }

  // 3. Apply.
  const effect = OUTBOX_EFFECTS[type]
  if (effect) {
    let q = db.from('email_outbox').update(effect.patch(at)).eq('id', row.id)
    if (effect.fromStatuses) q = q.in('status', effect.fromStatuses)
    if (effect.onlyIfNull) q = q.is(effect.onlyIfNull, null)
    const { error } = await q
    if (error) throw error
  }

  await finish({ applied_at: new Date().toISOString(), outbox_id: row.id })
  return { status: 'applied' }
}
