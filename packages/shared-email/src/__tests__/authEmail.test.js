import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EmailService } from '../EmailService.js'
import { sendAuthEmail, resolveAuthRedirect } from '../authEmail.js'

// The production failure was a hard 500 — `supabase.auth.admin.getUserByEmail`
// is not a function — because supabase-js has no by-email admin lookup. The
// tests below drive the real code path against a stub client, and the last test
// pins the API surface so the phantom call cannot be reintroduced.

const generateLink = vi.fn()
const createClient = vi.fn(() => ({ auth: { admin: { generateLink } } }))

vi.mock('@supabase/supabase-js', () => ({ createClient: (...a) => createClient(...a) }))

let enqueue
let flush
let flushed

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key'
  enqueue = vi.spyOn(EmailService.prototype, 'enqueue').mockResolvedValue({ id: 1 })
  createClient.mockClear()
  flushed = false
  flush = vi.spyOn(EmailService.prototype, 'processBatch').mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 20))
    flushed = true
    return { processed: 0, sent: 0, failed: 0 }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const linkResponse = {
  data: {
    properties: { action_link: 'https://stub.supabase.co/auth/v1/verify?token=abc' },
    user: { id: 'user-1', email: 'someone@example.com' },
  },
  error: null,
}

describe('sendAuthEmail password reset', () => {
  it('mints a recovery link server-side and enqueues it with the branded sender', async () => {
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({
      action: 'password_reset',
      email: 'Someone@Example.com',
      app: 'carehub',
    })

    expect(result).toEqual({ ok: true, sent: true })
    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'someone@example.com',
      options: { redirectTo: 'https://carefindhub.com/reset-password' },
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    const row = enqueue.mock.calls[0][0]
    expect(row.templateKey).toBe('password_reset')
    expect(row.toEmail).toBe('someone@example.com')
    // The verified-domain sender is what routes the row to the CareHub template
    // set via resolveAppFromSender(); a CareFind sender here would render the
    // wrong brand for a CareHub user.
    expect(row.fromEmail).toBe('CareHub <support@mail.carefindhub.com>')
    expect(row.payload.resetLink).toBe('https://stub.supabase.co/auth/v1/verify?token=abc')
  })

  it('mints the recovery link into the derived path, never a caller-supplied host', async () => {
    // generateLink embeds redirect_to in the emailed link and the recovery
    // token rides in its URL fragment, so a caller-chosen host is an account
    // takeover primitive. Every one of these must be discarded.
    const hostile = [
      'https://evil.example/steal',
      'https://carefindhub.com.evil.example/',
      '//evil.example',
      'https://carefindhub.com@evil.example',
      'https://carefindhub.com/../../evil',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
    ]
    for (const redirectTo of hostile) {
      generateLink.mockClear()
      enqueue.mockClear()
      generateLink.mockResolvedValue(linkResponse)

      await sendAuthEmail({ action: 'password_reset', email: 'user@example.com', redirectTo, app: 'carehub' })

      expect(
        generateLink.mock.calls[0][0].options.redirectTo,
        `redirectTo was honoured for ${redirectTo}`
      ).toBe('https://carefindhub.com/reset-password')
      expect(enqueue.mock.calls[0][0].payload.resetLink).toBe('https://stub.supabase.co/auth/v1/verify?token=abc')
    }
  })

  it('never throws for an unknown address, and enqueues nothing', async () => {
    // generateLink is also the account-existence check: it errors for unknown
    // emails. Throwing here would turn a routine "no such account" request into
    // a 500 and let a caller distinguish registered addresses.
    generateLink.mockResolvedValue({ data: null, error: { message: 'User with this email not found' } })

    await expect(
      sendAuthEmail({ action: 'password_reset', email: 'nobody@nowhere.invalid', app: 'carehub' })
    ).resolves.toEqual({ ok: true, sent: false })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('awaits the outbox flush before returning', async () => {
    // Fire-and-forget was a real defect: a serverless invocation can be frozen
    // the moment the response is sent, killing the flush mid-flight and leaving
    // the email queued until the next cron — which runs once a day.
    generateLink.mockResolvedValue(linkResponse)

    await sendAuthEmail({ action: 'password_reset', email: 'someone@example.com', app: 'carehub' })

    expect(flush).toHaveBeenCalledTimes(1)
    expect(flushed).toBe(true)
  })

  it('reports sent when the flush itself fails, so the caller can still return a generic 200', async () => {
    generateLink.mockResolvedValue(linkResponse)
    flush.mockRejectedValue(new Error('Resend 429'))

    await expect(
      sendAuthEmail({ action: 'password_reset', email: 'someone@example.com', app: 'carehub' })
    ).resolves.toEqual({ ok: true, sent: true })
    expect(enqueue).toHaveBeenCalled()
  })

  it('personalises from the resolved auth user, falling back to the localpart', async () => {
    generateLink.mockResolvedValue(linkResponse)
    const seen = []

    await sendAuthEmail({
      action: 'password_reset',
      email: 'someone@example.com',
      app: 'carehub',
      resolveDisplayName: async (user) => { seen.push(user); return '  Ada Lovelace  ' },
    })
    expect(seen[0]).toEqual({ id: 'user-1', email: 'someone@example.com' })
    expect(enqueue.mock.calls[0][0].payload.fullName).toBe('Ada Lovelace')

    enqueue.mockClear()
    await sendAuthEmail({
      action: 'password_reset',
      email: 'someone@example.com',
      app: 'carehub',
      resolveDisplayName: async () => '',
    })
    expect(enqueue.mock.calls[0][0].payload.fullName).toBe('someone')
  })

  it('uses the caller\'s client instead of resolving supabase-js from this package', async () => {
    // A bare '@supabase/supabase-js' specifier does not resolve from
    // packages/shared-email on Vercel — the workspace is deployed without its
    // own node_modules — so the app must inject a client it already built.
    generateLink.mockResolvedValue(linkResponse)
    const injected = { auth: { admin: { generateLink } } }

    await sendAuthEmail({ action: 'password_reset', email: 'someone@example.com', app: 'carehub', supabase: injected })

    expect(generateLink).toHaveBeenCalledTimes(1)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('never reintroduces a by-email admin lookup', async () => {
    // supabase-js has no auth.admin.getUserByEmail, so calling one was a hard
    // 500 in production. generateLink is the only admin call this module needs:
    // it resolves the account and mints the link in one round trip. Asserted on
    // the source because a stub client would happily define the phantom method,
    // and the real SDK is not resolvable from this package (see EmailService).
    // Comments are stripped first so the guard does not flag its own rationale.
    const source = readFileSync(resolve(process.cwd(), 'src/authEmail.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(source).not.toMatch(/getUserByEmail/)
    const adminCalls = [...source.matchAll(/admin\.(\w+)\(/g)].map((m) => m[1])
    expect(adminCalls.length).toBeGreaterThan(0)
    expect([...new Set(adminCalls)]).toEqual(['generateLink'])
  })
})

describe('resolveAuthRedirect', () => {
  it('maps each app and action to a route that actually exists', () => {
    expect(resolveAuthRedirect('carehub', 'password_reset')).toBe('https://carefindhub.com/reset-password')
    expect(resolveAuthRedirect('carefind', 'password_reset')).toBe('https://carefind.app/reset-password')
    expect(resolveAuthRedirect('carefind', 'email_verification')).toBe('https://carefind.app/verify-email')
    // CareHub has no /verify-email route and its catch-all rewrites unknown
    // paths to '/', so it must not claim one.
    expect(resolveAuthRedirect('carehub', 'email_verification')).toBe('https://carefindhub.com/login')
  })

  it('returns a same-origin URL whatever the caller asked for', () => {
    for (const requested of [
      undefined, null, '',
      'https://evil.example', 'https://carefind.app.evil.example',
      '//evil.example', 'https://carefind.app@evil.example',
      'https://carefind.app/evil', 'javascript:alert(1)', '/reset-password',
    ]) {
      const out = resolveAuthRedirect('carefind', 'password_reset', requested)
      expect(out).toBe('https://carefind.app/reset-password')
      expect(() => new URL(out).origin).not.toThrow()
    }
  })

  it('refuses to build a link target for an action it has no route for', () => {
    // Throwing is correct here: both callers swallow exceptions into a generic
    // 200, so an unconfigured action must not silently mint a link to '/'.
    expect(() => resolveAuthRedirect('carefind', 'customer_registration')).toThrow(/redirect path/)
    expect(() => resolveAuthRedirect('carehub', 'customer_registration')).toThrow(/carehub:customer_registration/)
  })

  it('falls back to CareFind branding for an unrecognised app', () => {
    // Matches sendAuthEmail's own APP_BRANDING fallback. Harmless because `app`
    // is hardcoded per handler and never read from the request body.
    expect(resolveAuthRedirect('nope', 'password_reset')).toBe('https://carefind.app/reset-password')
  })
})
