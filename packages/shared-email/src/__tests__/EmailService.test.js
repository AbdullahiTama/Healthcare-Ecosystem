import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EmailService, getEmailService } from '../EmailService.js'

// Minimal chainable stub: processBatch() only needs the pending/failed query
// to resolve empty, so no row ever reaches sendEmail and Resend is untouched.
function emptyOutboxDb() {
  const table = {
    select: () => table,
    in: () => table,
    lte: () => table,
    order: () => table,
    limit: async () => ({ data: [], error: null }),
  }
  return { from: () => table }
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

describe('EmailService dependency loading', () => {
  it('processBatch works with an injected client and never loads supabase-js', async () => {
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
