import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EmailService } from '../EmailService.js'
import { sendAuthEmail } from '../authEmail.js'

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

describe('sendAuthEmail staff_setup', () => {
  it('mints a recovery link and enqueues staff_welcome with no credential fields', async () => {
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({
      action: 'staff_setup',
      email: 'new.staff@carehub.ng',
      fullName: 'New Staff',
      businessName: 'HealthPlus',
      role: 'Pharmacist',
      redirectTo: 'https://carefindhub.com/reset-password',
      app: 'carehub',
    })

    expect(result).toEqual({ ok: true, sent: true })
    expect(generateLink).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'new.staff@carehub.ng',
      options: { redirectTo: 'https://carefindhub.com/reset-password' },
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    const row = enqueue.mock.calls[0][0]
    expect(row.templateKey).toBe('staff_welcome')
    expect(row.payload.setupLink).toBe('https://stub.supabase.co/auth/v1/verify?token=abc')
    expect(row.payload.businessName).toBe('HealthPlus')
    expect(row.payload.role).toBe('Pharmacist')
    // The whole point of the flow: no credential material in the payload.
    const keys = Object.keys(row.payload).map((k) => k.toLowerCase())
    for (const bad of ['password', 'passwd', 'pwd', 'token', 'secret', 'otp', 'session', 'credential']) {
      expect(keys.some((k) => k.includes(bad))).toBe(false)
    }
    expect(JSON.stringify(row.payload)).not.toContain('placeholder')
  })
})

describe('sendAuthEmail password reset', () => {
  it('mints a recovery link server-side and enqueues it with the branded sender', async () => {
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({
      action: 'password_reset',
      email: 'Someone@Example.com',
      redirectTo: 'https://carefindhub.com/reset-password',
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

// ── Abuse resistance ────────────────────────────────────────────────────────
// sendAuthEmail backs the unauthenticated /api/auth-email endpoints, so it must not be usable to flood an address,
// to invalidate a victim's reset link by minting new ones, or to put caller-chosen text into someone else's email.

// A client whose email_outbox count answers the per-recipient rate-limit query.
function clientWithRecentCount(count, { error = null } = {}) {
  const query = { filters: [] }
  const b = {}
  b.select = (cols, opts) => { query.select = [cols, opts]; return b }
  b.eq = (c, v) => { query.filters.push(['eq', c, v]); return b }
  b.gte = (c, v) => { query.filters.push(['gte', c, v]); return b }
  b.then = (resolve) => resolve({ count, data: null, error })
  return { query, client: { auth: { admin: { generateLink } }, from: (table) => { query.table = table; return b } } }
}

describe('sendAuthEmail rate limiting', () => {
  it('stops after 3 password resets to one address in an hour, without minting another link', async () => {
    const { client, query } = clientWithRecentCount(3)
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({ action: 'password_reset', email: 'victim@example.com', app: 'carehub', supabase: client })

    expect(result).toEqual({ ok: true, sent: false, limited: true })
    // minting a link invalidates the previous one, so a flood must not reach generateLink at all
    expect(generateLink).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    expect(query.table).toBe('email_outbox')
    expect(query.filters).toContainEqual(['eq', 'to_email', 'victim@example.com'])
    expect(query.filters).toContainEqual(['eq', 'template_key', 'password_reset'])
    expect(query.filters.find(([op, col]) => op === 'gte' && col === 'created_at')).toBeTruthy()
  })

  it('still sends while under the limit', async () => {
    const { client } = clientWithRecentCount(2)
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({ action: 'password_reset', email: 'someone@example.com', app: 'carehub', supabase: client })

    expect(result).toEqual({ ok: true, sent: true })
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('allows 5 verification emails an hour', async () => {
    generateLink.mockResolvedValue(linkResponse)

    const at4 = await sendAuthEmail({ action: 'email_verification', email: 'a@example.com', app: 'carefind', supabase: clientWithRecentCount(4).client })
    const at5 = await sendAuthEmail({ action: 'email_verification', email: 'a@example.com', app: 'carefind', supabase: clientWithRecentCount(5).client })

    expect(at4.sent).toBe(true)
    expect(at5).toEqual({ ok: true, sent: false, limited: true })
  })

  it('limits staff invitations by the template they are stored under (staff_welcome)', async () => {
    const { client, query } = clientWithRecentCount(5)
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({ action: 'staff_setup', email: 'staff@example.com', app: 'carehub', supabase: client, businessName: 'B', role: 'R' })

    expect(result).toEqual({ ok: true, sent: false, limited: true })
    expect(query.filters).toContainEqual(['eq', 'template_key', 'staff_welcome'])
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('fails open when the limit cannot be checked, so a database hiccup never blocks a real reset', async () => {
    const { client } = clientWithRecentCount(null, { error: { message: 'db down' } })
    generateLink.mockResolvedValue(linkResponse)

    const result = await sendAuthEmail({ action: 'password_reset', email: 'someone@example.com', app: 'carehub', supabase: client })

    expect(result.sent).toBe(true)
  })
})

describe('sendAuthEmail content from untrusted callers', () => {
  it('ignores a caller-supplied name on public actions (password reset text cannot be chosen by a stranger)', async () => {
    generateLink.mockResolvedValue({ ...linkResponse, data: { ...linkResponse.data, user: { id: 'user-1', email: 'someone@example.com' } } })

    await sendAuthEmail({ action: 'password_reset', email: 'someone@example.com', fullName: 'Your account is suspended, call 0800-EVIL', app: 'carehub' })

    expect(enqueue.mock.calls[0][0].payload.fullName).toBe('someone')
  })

  it('uses the name stored on the account, cleaned and capped', async () => {
    generateLink.mockResolvedValue({
      ...linkResponse,
      data: { ...linkResponse.data, user: { id: 'user-1', email: 'someone@example.com', user_metadata: { full_name: `Ada ${'x'.repeat(200)}` } } },
    })

    await sendAuthEmail({ action: 'email_verification', email: 'someone@example.com', app: 'carefind' })

    const name = enqueue.mock.calls[0][0].payload.fullName
    expect(name.startsWith('Ada ')).toBe(true)
    expect(name).not.toContain('')
    expect(name.length).toBeLessThanOrEqual(80)
  })

  it('sends one welcome email per address, ever', async () => {
    await sendAuthEmail({ action: 'customer_registration', email: 'New@Example.com', fullName: 'New Person', app: 'carefind' })

    const row = enqueue.mock.calls[0][0]
    expect(row.idempotencyKey).toBe('customer_registration:new@example.com')
  })

  it('caps and cleans the name in a welcome email', async () => {
    await sendAuthEmail({ action: 'customer_registration', email: 'new@example.com', fullName: `Eve 
${'y'.repeat(300)}`, app: 'carefind' })

    const name = enqueue.mock.calls[0][0].payload.fullName
    expect(name).not.toMatch(/[ -]/)
    expect(name.length).toBeLessThanOrEqual(80)
  })
})
