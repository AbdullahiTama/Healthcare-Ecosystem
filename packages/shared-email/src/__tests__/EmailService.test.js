import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EmailService, getEmailService, redactPayload } from '../EmailService.js'
import { getTemplate, getSubject, TEMPLATE_KEYS } from '../templates/index.js'

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

// In-memory stand-in for the email_outbox table, faithful enough to test
// claiming. The previous stub answered every update with {data:null} and every
// query with a fixed row list, so it applied no filters at all: it could not
// express ownership, and a test of the claim written against it would have
// passed no matter what the worker did. This one actually filters, mutates and
// returns rows, which is the only reason the concurrency tests mean anything.
function outboxTable(state) {
  const matchesOr = (r, clause) =>
    // PostgREST sends .or() as one comma separated string. The worker only
    // ever emits these two shapes, for the claim, so the fake understands
    // exactly those rather than pretending to parse the whole grammar.
    clause.split(',').some((c) => {
      const parts = c.split('.')
      const col = parts[0], op = parts[1], raw = parts.slice(2).join('.')
      if (op === 'is') return raw === 'null' ? r[col] == null : r[col] === raw
      if (op === 'lt') return r[col] != null && new Date(r[col]) < new Date(raw)
      return false
    })

  const builder = (patch) => {
    const filters = []
    let orderCol = null, orderAsc = true, limitN = null

    const run = () => {
      const out = state.rows.filter((r) =>
        filters.every((f) => (f.op === 'or' ? matchesOr(r, f.clause) : (
          f.op === 'eq' ? r[f.col] === f.val :
          f.op === 'in' ? f.vals.includes(r[f.col]) :
          f.op === 'lte' ? new Date(r[f.col]) <= new Date(f.val) : true
        )))
      )
      if (patch) for (const r of out) Object.assign(r, patch)
      if (orderCol) {
        out.sort((a, b) => {
          const av = new Date(a[orderCol]).getTime(), bv = new Date(b[orderCol]).getTime()
          return orderAsc ? av - bv : bv - av
        })
      }
      return limitN == null ? out : out.slice(0, limitN)
    }

    const b = {
      select: () => b,
      eq(col, val) { filters.push({ op: 'eq', col, val }); return b },
      in(col, vals) { filters.push({ op: 'in', col, vals }); return b },
      lte(col, val) { filters.push({ op: 'lte', col, val }); return b },
      or(clause) { filters.push({ op: 'or', clause }); return b },
      order(col, opts = {}) { orderCol = col; orderAsc = opts.ascending !== false; return b },
      limit(n) { limitN = n; return b },
      update(p) { state.updates.push(p); return builder(p) },
      async single() { return { data: run()[0] ?? null, error: null } },
      async maybeSingle() { return { data: run()[0] ?? null, error: null } },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej) },
    }
    return b
  }

  return { ...builder(null), update: (p) => { state.updates.push(p); return builder(p) } }
}

// Harness for the rollout controls. `settings` answers email_system_settings
// lookups and `rows` seeds the outbox the worker will claim from.
function rolloutDb({ settings = {}, rows = [] } = {}) {
  const state = { rows: rows.map((r) => ({ ...r })), updates: [], logs: [] }

  const settingsTable = {
    _key: null,
    select() { return this },
    eq(_col, key) { this._key = key; return this },
    async maybeSingle() {
      return { data: this._key in settings ? { value: settings[this._key] } : null, error: null }
    },
  }

  const logTable = { insert: async (r) => { state.logs.push(r); return { data: null, error: null } } }

  const db = {
    from: (t) => (t === 'email_system_settings' ? settingsTable : t === 'email_outbox' ? outboxTable(state) : logTable),
    __state: state,
  }
  return db
}

// A row the worker's own query would actually return: due now, unclaimed, and
// below its attempt ceiling.
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
    attempts: 0,
    max_attempts: 5,
    next_retry_at: new Date(Date.now() - 1000).toISOString(),
    claim_token: null,
    claimed_at: null,
    claim_expires_at: null,
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

    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 0 })
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
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1 })
    expect(db.__state.rows[0].last_error).toBe('canary_recipient_unset')
    // The claim is released, so the retry is not blocked behind a lease.
    expect(db.__state.rows[0].claim_token).toBeNull()
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
    // Deliberately fictional. This used to use business_revoked, which stopped
    // being a valid example the moment that key gained a renderer. A key no one
    // will ever implement keeps asserting the fail-closed path.
    const db = rolloutDb({ settings: {}, rows: [row({ template_key: 'no_such_template' })] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1 })
    expect(db.__state.rows[0].last_error).toBe('no_template:carehub:no_such_template')
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

// Two workers against one outbox is not a hypothetical: vercel.json scheduled
// /api/cron/process-email-outbox in both apps, and batch 4 adds a third caller.
// The old worker selected pending rows and sent them with no write marking
// ownership, so both workers read the same row and both sent it. These are the
// cases that bug would have produced.
describe('exclusive row claiming', () => {
  it('sends a row exactly once when two workers run at the same time', async () => {
    const db = rolloutDb({ settings: {}, rows: [row()] })
    const a = new EmailService({ supabase: db })
    const b = new EmailService({ supabase: db })

    await Promise.all([a.processBatch(), b.processBatch()])

    // The actual customer visible symptom: the same email arriving twice.
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(db.__state.rows[0].status).toBe('sent')
  })

  it('leaves a row another worker still holds alone', async () => {
    const db = rolloutDb({
      settings: {},
      rows: [row({
        claim_token: 'someone-elses-uuid',
        claim_expires_at: new Date(Date.now() + 60000).toISOString(),
      })],
    })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ processed: 1, sent: 0, contended: 1 })
    // The live owner's claim is not stolen or overwritten.
    expect(db.__state.rows[0].claim_token).toBe('someone-elses-uuid')
  })

  it('reclaims a row whose owner died, rather than stranding it forever', async () => {
    // A worker killed mid batch leaves a lease with no process behind it. Without
    // expiry the row would never be picked up again and the email is simply lost.
    const db = rolloutDb({
      settings: {},
      rows: [row({
        claim_token: 'abandoned-uuid',
        claim_expires_at: new Date(Date.now() - 1000).toISOString(),
      })],
    })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ sent: 1, contended: 0 })
    expect(db.__state.rows[0].status).toBe('sent')
  })

  it('ignores a row whose retry is not due yet', async () => {
    const db = rolloutDb({
      settings: {},
      rows: [row({ next_retry_at: new Date(Date.now() + 3600000).toISOString() })],
    })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ processed: 0, sent: 0 })
  })

  it('releases the claim when the row is sent', async () => {
    const db = rolloutDb({ settings: {}, rows: [row()] })
    await new EmailService({ supabase: db }).processBatch()

    const sent = db.__state.rows[0]
    expect(sent.status).toBe('sent')
    expect(sent.claim_token).toBeNull()
    expect(sent.claim_expires_at).toBeNull()
  })
})

describe('per row attempt limit', () => {
  it('honours the row\'s own ceiling instead of the service default', async () => {
    // max_attempts is NOT NULL DEFAULT 5 on the column, so a row can legitimately
    // carry a different budget. Comparing against the service wide maxRetries
    // ignored that, so a 2 attempt row kept retrying to 5. A failing send makes
    // the difference observable: this row must die on its second attempt, where
    // the old comparison would have left it waiting for a fifth.
    sendEmailMock.mockResolvedValueOnce({ success: false, error: 'provider rejected' })
    const db = rolloutDb({ settings: {}, rows: [row({ attempts: 1, max_attempts: 2 })] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(result).toMatchObject({ sent: 0, failed: 1, exhausted: 0 })
    expect(db.__state.rows[0].status).toBe('dead')
    expect(db.__state.rows[0].attempts).toBe(2)
  })

  it('retires a row that has already used every attempt, without claiming or sending it', async () => {
    const db = rolloutDb({ settings: {}, rows: [row({ attempts: 5, max_attempts: 5 })] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ processed: 1, sent: 0, exhausted: 1 })
    // Never claimed, so no lease is left behind on a row nobody will process.
    expect(db.__state.updates).toEqual([])
  })

  it('still retries a row that is below its ceiling', async () => {
    const db = rolloutDb({ settings: {}, rows: [row({ attempts: 2, max_attempts: 5 })] })
    const result = await new EmailService({ supabase: db }).processBatch()

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ sent: 1, exhausted: 0 })
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

describe('subject resolution', () => {
  it('falls back to the canonical subject when the row carries none', async () => {
    // The referral helpers enqueued with no subject at all, so these rows used to
    // go out with an empty subject line.
    const db = rolloutDb({ settings: {}, rows: [row({ subject: '', template_key: 'password_reset' })] })
    await new EmailService({ supabase: db }).processBatch()
    expect(sendEmailMock.mock.calls[0][0].subject).toBe('Reset your password')
  })

  it('interpolates payload values into the canonical subject', async () => {
    const db = rolloutDb({
      settings: {},
      rows: [row({ subject: '', template_key: 'business_approved', payload: { businessName: 'Acme Clinic' } })],
    })
    await new EmailService({ supabase: db }).processBatch()
    expect(sendEmailMock.mock.calls[0][0].subject).toBe('Acme Clinic has been approved')
  })

  it('keeps a subject the producer set deliberately', async () => {
    // The operator test-send endpoint prefixes [TEST] and depends on it landing.
    const db = rolloutDb({ settings: {}, rows: [row({ subject: '[TEST] agent_approved' })] })
    await new EmailService({ supabase: db }).processBatch()
    expect(sendEmailMock.mock.calls[0][0].subject).toBe('[TEST] agent_approved')
  })

  it('strips line breaks out of a stored subject', async () => {
    const db = rolloutDb({ settings: {}, rows: [row({ subject: 'Hello\r\nBcc: attacker@evil.test' })] })
    await new EmailService({ supabase: db }).processBatch()
    const { subject } = sendEmailMock.mock.calls[0][0]
    expect(subject).toBe('Hello Bcc: attacker@evil.test')
    expect(subject).not.toMatch(/[\r\n]/)
  })

  it('strips line breaks out of interpolated payload values', async () => {
    const db = rolloutDb({
      settings: {},
      rows: [row({
        subject: '',
        template_key: 'business_approved',
        payload: { businessName: 'Acme\r\nClinic' },
      })],
    })
    await new EmailService({ supabase: db }).processBatch()
    const { subject } = sendEmailMock.mock.calls[0][0]
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toBe('Acme Clinic has been approved')
  })

  it('fails closed when neither a stored nor a canonical subject exists', async () => {
    const db = rolloutDb({ settings: {}, rows: [row({ subject: '', template_key: 'no_such_template' })] })
    const result = await new EmailService({ supabase: db }).processBatch()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, failed: 1 })
    expect(db.__state.rows[0].last_error).toBe('no_template:carehub:no_such_template')
  })

  it('gives every registered template a canonical subject for its own app', () => {
    // Ratchet: adding a renderer without a subject would reintroduce the
    // subject-less email this whole path exists to prevent.
    for (const app of ['carehub', 'carefind']) {
      for (const key of TEMPLATE_KEYS[app]) {
        expect(getSubject(key, app, { fullName: 'X', businessName: 'X', plan: 'X', orderRef: 'X', status: 'X', agentName: 'X' }), `${app}:${key}`).not.toBe('')
      }
    }
  })

  it('renders the referral and business lifecycle keys that were missing', () => {
    for (const key of ['agent_approved', 'agent_rejected', 'business_reactivated', 'business_revoked']) {
      expect(getTemplate(key, 'carehub'), key).toBeTypeOf('function')
      expect(getSubject(key, 'carehub', { agentName: 'Ada', businessName: 'Acme' }), key).not.toBe('')
    }
  })
})
