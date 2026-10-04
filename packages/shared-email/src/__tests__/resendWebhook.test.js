import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifySvixSignature, applyResendEvent } from '../resendWebhook.js'

// Resend signs webhooks with Svix: headers svix-id / svix-timestamp / svix-signature ("v1,<base64>", space separated
// when a secret is being rotated), HMAC-SHA256 over `${id}.${timestamp}.${rawBody}` keyed with the base64-decoded part
// of the whsec_ secret. The old handler checked a made-up x-resend-signature hex HMAC over re-serialised JSON, which a
// real delivery can never match, so every bounce and complaint was rejected with a 401.

const KEY = Buffer.from('a-very-secret-signing-key-0123456')
const SECRET = `whsec_${KEY.toString('base64')}`
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0)
const ts = (offsetSeconds = 0) => String(Math.floor(NOW / 1000) + offsetSeconds)

function sign(body, { id = 'msg_1', timestamp = ts(), key = KEY } = {}) {
  return 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}
function headersFor(body, over = {}) {
  const id = over.id ?? 'msg_1'
  const timestamp = over.timestamp ?? ts()
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': over.signature ?? sign(body, { id, timestamp }) }
}
const BODY = JSON.stringify({ type: 'email.bounced', data: { email_id: 'prov-1' } })

describe('verifySvixSignature', () => {
  const check = (over = {}, body = BODY) => verifySvixSignature({ rawBody: body, headers: over.headers ?? headersFor(body, over), secret: over.secret ?? SECRET, now: NOW })

  it('accepts a correctly signed delivery', () => {
    expect(check()).toEqual({ ok: true })
  })

  it('accepts a Buffer body, since the router keeps the raw bytes', () => {
    expect(verifySvixSignature({ rawBody: Buffer.from(BODY), headers: headersFor(BODY), secret: SECRET, now: NOW })).toEqual({ ok: true })
  })

  it('rejects a body that was changed after signing', () => {
    const headers = headersFor(BODY)
    expect(verifySvixSignature({ rawBody: BODY.replace('prov-1', 'prov-2'), headers, secret: SECRET, now: NOW })).toMatchObject({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects the old x-resend-signature scheme', () => {
    const headers = { 'x-resend-signature': createHmac('sha256', 'whatever').update(BODY).digest('hex') }
    expect(check({ headers })).toMatchObject({ ok: false, reason: 'missing_headers' })
  })

  it('rejects a signature made with a different secret', () => {
    const forged = sign(BODY, { key: Buffer.from('another-secret') })
    expect(check({ signature: forged })).toMatchObject({ ok: false, reason: 'invalid_signature' })
  })

  it('accepts any one valid signature when several are listed (secret rotation)', () => {
    const rotated = `v1,${Buffer.from('stale').toString('base64')} ${sign(BODY)}`
    expect(check({ signature: rotated })).toEqual({ ok: true })
  })

  it('rejects a replayed delivery whose timestamp is too old', () => {
    const timestamp = ts(-400)
    expect(check({ timestamp, signature: sign(BODY, { timestamp }) })).toMatchObject({ ok: false, reason: 'timestamp_outside_tolerance' })
  })

  it('rejects a timestamp too far in the future', () => {
    const timestamp = ts(400)
    expect(check({ timestamp, signature: sign(BODY, { timestamp }) })).toMatchObject({ ok: false, reason: 'timestamp_outside_tolerance' })
  })

  it('rejects a timestamp that is not a number', () => {
    expect(check({ timestamp: 'yesterday', signature: sign(BODY, { timestamp: 'yesterday' }) })).toMatchObject({ ok: false, reason: 'timestamp_outside_tolerance' })
  })

  it('fails closed with no secret configured', () => {
    expect(verifySvixSignature({ rawBody: BODY, headers: headersFor(BODY), secret: '', now: NOW })).toMatchObject({ ok: false, reason: 'secret_not_configured' })
  })

  it('does not throw on a malformed or wrong-length signature', () => {
    expect(check({ signature: 'v1,' })).toMatchObject({ ok: false })
    expect(check({ signature: 'garbage' })).toMatchObject({ ok: false })
    expect(check({ signature: 'v1,AAAA' })).toMatchObject({ ok: false })
  })
})

// A small in-memory stand-in for the two tables the webhook touches.
function makeDb({ outbox = [], events = [], failEventInsert = null } = {}) {
  const state = { outbox: outbox.map((r) => ({ ...r })), events: events.map((r) => ({ ...r })) }
  const from = (table) => {
    const q = { filters: [], patch: null, insertRow: null, wantRows: false }
    const rows = () => (table === 'email_outbox' ? state.outbox : state.events)
    const match = (r) => q.filters.every(([op, col, val]) => (op === 'eq' ? r[col] === val : op === 'is' ? (r[col] ?? null) === val : op === 'in' ? val.includes(r[col]) : true))
    const b = {}
    b.select = () => { q.wantRows = true; return b }
    b.eq = (c, v) => { q.filters.push(['eq', c, v]); return b }
    b.is = (c, v) => { q.filters.push(['is', c, v]); return b }
    b.in = (c, v) => { q.filters.push(['in', c, v]); return b }
    b.update = (patch) => { q.patch = patch; return b }
    b.insert = (row) => { q.insertRow = row; return b }
    const run = () => {
      if (q.insertRow) {
        if (failEventInsert) return { data: null, error: failEventInsert }
        if (table === 'email_provider_events' && state.events.some((e) => e.provider_event_id === q.insertRow.provider_event_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        const row = { id: `ev-${state.events.length + 1}`, applied_at: null, apply_error: null, ...q.insertRow }
        rows().push(row)
        return { data: [row], error: null }
      }
      const hit = rows().filter(match)
      if (q.patch) { hit.forEach((r) => Object.assign(r, q.patch)); return { data: hit, error: null } }
      return { data: hit, error: null }
    }
    // like supabase-js: a failed query resolves to { data: null, error }, it does not throw
    const first = () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } }
    b.maybeSingle = async () => first()
    b.single = async () => first()
    b.then = (resolve, reject) => Promise.resolve(run()).then(resolve, reject)
    return b
  }
  return { from, state }
}

const sentRow = (over = {}) => ({ id: 'outbox-1', status: 'sent', provider_message_id: 'prov-1', bounced_at: null, complained_at: null, delivered_at: null, opened_at: null, ...over })
const ev = (type, over = {}) => ({ type, created_at: '2026-10-04T11:59:00.000Z', data: { email_id: 'prov-1', to: ['someone@example.com'], ...over } })

describe('applyResendEvent', () => {
  let db
  beforeEach(() => { db = makeDb({ outbox: [sentRow()] }) })

  it('records a bounce: the event row, the outbox status and timestamp, and marks the event applied', async () => {
    const result = await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced', { bounce: { type: 'Permanent', subType: 'General' } }) })

    expect(result).toMatchObject({ status: 'applied' })
    expect(db.state.outbox[0]).toMatchObject({ status: 'bounced', bounced_at: '2026-10-04T11:59:00.000Z' })
    expect(db.state.events[0]).toMatchObject({ provider_event_id: 'msg_1', provider_message_id: 'prov-1', event_type: 'email.bounced', outbox_id: 'outbox-1' })
    expect(db.state.events[0].applied_at).toBeTruthy()
  })

  it('finds the outbox row by the provider message id, not by the outbox id', async () => {
    db = makeDb({ outbox: [sentRow({ id: 'prov-1', provider_message_id: 'something-else' }), sentRow({ id: 'outbox-2', provider_message_id: 'prov-1' })] })

    await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced') })

    expect(db.state.outbox.find((r) => r.id === 'outbox-2').status).toBe('bounced')
    expect(db.state.outbox.find((r) => r.id === 'prov-1').status).toBe('sent')
  })

  it('records a complaint', async () => {
    await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.complained') })

    expect(db.state.outbox[0]).toMatchObject({ status: 'complained', complained_at: '2026-10-04T11:59:00.000Z' })
  })

  it('does not let a later bounce downgrade a complaint', async () => {
    await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.complained') })
    await applyResendEvent(db, { svixId: 'msg_2', event: ev('email.bounced') })

    expect(db.state.outbox[0].status).toBe('complained')
  })

  it('records delivery and opens as timestamps without changing the status', async () => {
    await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.delivered') })
    await applyResendEvent(db, { svixId: 'msg_2', event: ev('email.opened') })

    expect(db.state.outbox[0]).toMatchObject({ status: 'sent', delivered_at: '2026-10-04T11:59:00.000Z', opened_at: '2026-10-04T11:59:00.000Z' })
  })

  it('treats a repeated delivery of the same event as already done', async () => {
    await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced') })
    db.state.outbox[0].status = 'sent' // would be flipped again if the event were re-applied
    db.state.outbox[0].bounced_at = null

    const result = await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced') })

    expect(result).toMatchObject({ status: 'duplicate' })
    expect(db.state.outbox[0].status).toBe('sent')
    expect(db.state.events).toHaveLength(1)
  })

  it('re-applies an event whose first delivery was recorded but never applied', async () => {
    db = makeDb({
      outbox: [sentRow()],
      events: [{ id: 'ev-0', provider_event_id: 'msg_1', provider_message_id: 'prov-1', event_type: 'email.bounced', applied_at: null }],
    })

    const result = await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced') })

    expect(result).toMatchObject({ status: 'applied' })
    expect(db.state.outbox[0].status).toBe('bounced')
  })

  it('records an event for a message that is not in the outbox and does not fail', async () => {
    const result = await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced', { email_id: 'unknown-id' }) })

    expect(result).toMatchObject({ status: 'unmatched' })
    expect(db.state.events[0].apply_error).toBe('no_outbox_row')
    expect(db.state.outbox[0].status).toBe('sent')
  })

  it('ignores an event with no message id', async () => {
    const result = await applyResendEvent(db, { svixId: 'msg_1', event: { type: 'email.bounced', data: {} } })

    expect(result).toMatchObject({ status: 'ignored' })
    expect(db.state.events).toHaveLength(0)
  })

  it('stores a type it does not act on, without touching the outbox row', async () => {
    await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.clicked') })

    expect(db.state.events[0].event_type).toBe('email.clicked')
    expect(db.state.outbox[0]).toMatchObject({ status: 'sent', delivered_at: null, opened_at: null })
  })

  it('keeps the recipient address out of the stored event metadata', async () => {
    await applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced', { bounce: { type: 'Permanent', subType: 'General', message: 'mailbox someone@example.com not found' } }) })

    const stored = JSON.stringify(db.state.events[0].safe_metadata)
    expect(stored).not.toContain('someone@example.com')
    expect(db.state.events[0].safe_metadata).toMatchObject({ bounce_type: 'Permanent', bounce_sub_type: 'General' })
  })

  it('throws when the event cannot be recorded, so the provider is told to retry', async () => {
    db = makeDb({ outbox: [sentRow()], failEventInsert: { code: '57P01', message: 'db down' } })

    await expect(applyResendEvent(db, { svixId: 'msg_1', event: ev('email.bounced') })).rejects.toMatchObject({ message: 'db down' })
  })
})
