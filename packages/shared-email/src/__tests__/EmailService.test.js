import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EmailService, getEmailService, redactPayload } from '../EmailService.js'

// The provider call is the only thing we must never make in these tests.
// Hoisted so it is in place before EmailService's module-level cache resolves.
const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true, data: 'provider-1' })))
vi.mock('../sendEmail.js', () => ({ sendEmail: sendEmailMock }))

beforeEach(() => { sendEmailMock.mockClear() })

// Minimal chainable stub: processBatch() only needs the pending/failed query
// to resolve empty, so no row ever reaches sendEmail and Resend is untouched.
// It also answers the email_system_settings lookups, which every batch performs
// for dispatch_paused and canary_recipient.
function emptyOutboxDb() {
  const table = {
    select: () => table,
    in: () => table,
    lte: () => table,
    order: () => table,
    limit: async () => ({ data: [], error: null }),
  }
  const settingsTable = {
    _key: null,
    select() { return this },
    eq(_col, key) { this._key = key; return this },
    maybeSingle: async () => ({ data: null, error: null }),
  }
  return { from: (t) => (t === 'email_system_settings' ? settingsTable : table) }
}

// Harness for the rollout controls. `settings` answers email_system_settings
// lookups and `rows` answers the worker's pending query, so each control can be
// exercised without a database or a provider call.
function rolloutDb({ settings = {}, rows = [] } = {}) {
  const state = { sent: [], updates: [], logs: [] }

  const settingsTable = {
    _key: null,
    select() { return this },
    eq(_col, key) { this._key = key; return this },
    async maybeSingle() {
      return { data: this._key in settings ? { value: settings[this._key] } : null, error: null }
    },
  }

  const outboxTable = {
    _eq: null,
    select() { return this },
    in() { return this },
    lte() { return this },
    order() { return this },
    limit: async () => ({ data: rows, error: null }),
    eq(_col, val) { this._eq = val; return this },
    async single() {
      return { data: rows.find((r) => r.id === this._eq) || { attempts: 0 }, error: null }
    },
    update(patch) {
      state.updates.push(patch)
      return { eq: async () => ({ data: null, error: null }) }
    },
  }

  const logTable = { insert: async (r) => { state.logs.push(r); return { data: null, error: null } } }

  const db = {
    from: (t) => (t === 'email_system_settings' ? settingsTable : t === 'email_outbox' ? outboxTable : logTable),
    __state: state,
  }
  return db
}

function row(overrides = {}) {
  return {
    id: 'outbox-1',
    to_email: 'real.customer@gmail.com',
    from_email: 'CareHub <support@mail.carefindhub.com>',
    subject: 'CareHub: test',
    template_key: 'password_reset',
    payload: { fullName: 'Real Customer', resetLink: 'https://supabase.example/auth/v1/verify?token=SECRETTOKEN' },
    status: 'pending',
    is_canary: false,
    ...overrides,
  }
}

describe('EmailService.enqueue quarantine contract', () => {
  // guard_email_outbox_quarantine() is a BEFORE INSERT trigger that sets
  // next_retry_at='infinity' whenever app or event_key is null, so the row never
  // matches processBatch's `next_retry_at <= now` filter. Every legacy call site
  // omitted both columns, so the whole outbox was silently undeliverable.
  const insertCapture = () => {
    const state = { row: null, logs: [] }
    const logTable = { insert: async (r) => { state.logs.push(r); return { data: null, error: null } } }
    const rowTable = {
      insert: (r) => { state.row = r; return { select: () => ({ single: async () => ({ data: { id: 'outbox-1' }, error: null }) }) } },
    }
    state.db = { from: (t) => (t === 'email_outbox' ? rowTable : logTable) }
    return state
  }

  it('stamps app and event_key so the quarantine trigger cannot park the row', async () => {
    const state = insertCapture()
    await new EmailService({ supabase: state.db }).enqueue({
      templateKey: 'password_reset',
      toEmail: 'user@example.com',
      fromEmail: 'CareHub <support@mail.carefindhub.com>',
    })

    expect(state.row.app).toBe('carehub')
    expect(state.row.event_key).toBe('password_reset')
    // The eligibility window the worker actually filters on.
    expect(new Date(state.row.next_retry_at).getTime()).toBeLessThanOrEqual(Date.now())
    expect(state.row.status).toBe('pending')
  })

  it('derives carefind from the CareFind sender when no app is given', async () => {
    const state = insertCapture()
    await new EmailService({ supabase: state.db }).enqueue({
      templateKey: 'appointment_reminder',
      toEmail: 'user@example.com',
      fromEmail: 'CareFind <support@mail.carefind.app>',
    })
    expect(state.row.app).toBe('carefind')
    expect(state.row.event_key).toBe('appointment_reminder')
  })

  it('honours an explicit app and event key over the derived values', async () => {
    const state = insertCapture()
    await new EmailService({ supabase: state.db }).enqueue({
      templateKey: 'password_reset',
      toEmail: 'user@example.com',
      fromEmail: 'CareHub <support@mail.carefindhub.com>',
      app: 'carefind',
      eventKey: 'legacy_alias',
    })
    expect(state.row.app).toBe('carefind')
    expect(state.row.event_key).toBe('legacy_alias')
  })

  it('never leaves app or event_key null, whatever the caller passes', async () => {
    const state = insertCapture()
    await new EmailService({ supabase: state.db }).enqueue({
      templateKey: 'custom_thing',
      toEmail: 'user@example.com',
      fromEmail: 'something-else@example.com',
    })
    expect(state.row.app).toBeTruthy()
    expect(state.row.event_key).toBeTruthy()
  })
})

describe('EmailService dependency loading', () => {  it('processBatch works with an injected client and never loads supabase-js', async () => {
    const service = new EmailService({ supabase: emptyOutboxDb() })
    const result = await service.processBatch()
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 })
  })

  it('getEmailService forwards options so the first caller can inject a client', () => {
    const db = emptyOutboxDb()
    expect(getEmailService({ supabase: db })._db).toBe(db)
  })

  // The production failure was a runtime "Cannot find package
  // '@supabase/supabase-js'": a bare specifier only resolves by walking up from
  // packages/shared-email/, and Vercel deploys that package without its own
  // node_modules. deps() runs on every processBatch(), so the import had to
  // move out of it, not just be lazy. Asserted on the source because a
  // behavioural test only fails where resolution happens to be broken.
  it('keeps the supabase-js specifier out of deps()', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../EmailService.js', import.meta.url)),
      'utf8'
    )
    // Slice to the closing brace of deps() only. Cutting at loadCreateClient()
    // would sweep in the comment above it, which quotes the specifier.
    const start = source.indexOf('async function deps()')
    const depsBody = source.slice(start, source.indexOf('\n}', start) + 2)
    expect(depsBody).not.toContain('@supabase/supabase-js')
    expect(source).toContain("import('@supabase/supabase-js')")
  })
})

// dispatch_paused lived in the schema and in three specifications with nothing
// reading it. These four cases are the reason the switch is now trustworthy.
describe('dispatch_paused is enforced', () => {
  it('claims and sends nothing while paused', async () => {
    const db = rolloutDb({ settings: { dispatch_paused: true }, rows: [row()] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(result).toEqual({ processed: 0, sent: 0, failed: 0, paused: true })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(db.__state.updates).toEqual([])
  })

  it('sends normally once the switch is off', async () => {
    const db = rolloutDb({ settings: { dispatch_paused: false }, rows: [row()] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('treats a missing setting as not paused, so a settings read failure cannot silently stop all mail', async () => {
    const db = rolloutDb({ settings: {}, rows: [row()] })
    const result = await new EmailService({ supabase: db }).processBatch()
    expect(result.sent).toBe(1)
  })
})

describe('canary addressing', () => {
  it('redirects a canary row to the canary recipient and redacts the token', async () => {
    const db = rolloutDb({
      settings: { canary_recipient: 'canary@carefindhub.com' },
      rows: [row({ is_canary: true })],
    })
    await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const sent = sendEmailMock.mock.calls[0][0]
    expect(sent.to).toBe('canary@carefindhub.com')
    expect(sent.html).not.toContain('SECRETTOKEN')
    // The recipient's own details are kept: a canary has to prove the template
    // renders real content, not an empty shell.
    expect(sent.html).toContain('Real Customer')
  })

  it('fails closed when no canary recipient is set, and never sends to the real recipient', async () => {
    const db = rolloutDb({ settings: {}, rows: [row({ is_canary: true })] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 })
    expect(db.__state.updates[0].last_error).toBe('canary_recipient_unset')
  })

  it('leaves a live row completely untouched', async () => {
    const db = rolloutDb({
      settings: { canary_recipient: 'canary@carefindhub.com' },
      rows: [row()],
    })
    await new EmailService({ supabase: db }).processBatch()

    const sent = sendEmailMock.mock.calls[0][0]
    expect(sent.to).toBe('real.customer@gmail.com')
    expect(sent.html).toContain('SECRETTOKEN')
  })
})

describe('templates fail closed', () => {
  it('marks the row failed instead of mailing an empty body', async () => {
    const db = rolloutDb({ settings: {}, rows: [row({ template_key: 'business_revoked' })] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 })
    expect(db.__state.updates[0].last_error).toBe('no_template:carehub:business_revoked')
  })

  it('does not borrow the other app template when one app lacks the key', async () => {
    // booking_confirmed only exists for CareFind. A CareHub row carrying it used
    // to resolve through the merged registry and mail CareFind branding.
    const db = rolloutDb({
      settings: {},
      rows: [row({ template_key: 'booking_confirmed' })],
    })
    await new EmailService({ supabase: db }).processBatch()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})

describe('redactPayload', () => {
  it('replaces credential bearing keys at any depth', () => {
    expect(redactPayload({ fullName: 'Ada', resetLink: 'x', verifyLink: 'y', setupToken: 'z' }))
      .toEqual({ fullName: 'Ada', resetLink: '[redacted]', verifyLink: '[redacted]', setupToken: '[redacted]' })
    expect(redactPayload({ a: { b: { otp: '1234', label: 'ok' } } }))
      .toEqual({ a: { b: { otp: '[redacted]', label: 'ok' } } })
  })

  it('leaves order line items and plain values intact', () => {
    const payload = { items: [{ name: 'Lifeline', quantity: 2, price: 500 }], total: 1000 }
    expect(redactPayload(payload)).toEqual(payload)
  })
})
