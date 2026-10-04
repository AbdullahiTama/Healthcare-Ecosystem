import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import handler from '../_handlers/auth-email.js'

// Regression cover for the production 500 on password reset: the handler called
// `supabase.auth.admin.getUserByEmail`, which supabase-js does not implement, so
// every "send my reset link" click threw before a single row was enqueued.

const sendAuthEmail = vi.fn()
const generateLink = vi.fn()
// supabase-js query builders are thenables, not Promises. A stub whose
// maybeSingle() returned a real Promise would expose a .catch() and so hide the
// production TypeError; this mirrors the real shape instead.
const thenable = (value) => ({ then: (onOk, onErr) => Promise.resolve(value).then(onOk, onErr) })
const table = { select: () => table, eq: () => table, ilike: () => table, maybeSingle: () => thenable({ data: null, error: null }) }
const supabase = { from: () => table, auth: { admin: { generateLink } } }

vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabase }))
vi.mock('@care-ecosystem/shared-email', () => ({ sendAuthEmail: (...a) => sendAuthEmail(...a) }))

const post = (body) => {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return handler({ method: 'POST', body }, res).then(() => res)
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key'
  // The handler pads every public response to a minimum duration (timing side channel); switch the floor off for speed.
  process.env.AUTH_EMAIL_MIN_RESPONSE_MS = '0'
  sendAuthEmail.mockReset().mockResolvedValue({ ok: true, sent: true })
  generateLink.mockReset()
})

afterEach(() => {
  delete process.env.AUTH_EMAIL_MIN_RESPONSE_MS
  vi.restoreAllMocks()
})

describe('/api/auth-email', () => {
  it('rejects non-POST and malformed input before touching Supabase', async () => {
    const res = { statusCode: 0, body: null }
    res.status = (c) => { res.statusCode = c; return res }
    res.json = (b) => { res.body = b; return res }
    await handler({ method: 'GET', body: {} }, res)
    expect(res.statusCode).toBe(405)

    expect((await post({ action: 'password_reset' })).statusCode).toBe(400)
    expect((await post({ action: 'password_reset', email: 'nope' })).statusCode).toBe(400)
    expect((await post({ action: 'sneeze', email: 'a@b.com' })).statusCode).toBe(400)
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it('returns 200 { ok: true } and hands the link work to shared-email', async () => {
    const res = await post({ action: 'password_reset', email: 'user@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
    const arg = sendAuthEmail.mock.calls[0][0]
    expect(arg.action).toBe('password_reset')
    expect(arg.email).toBe('user@example.com')
    expect(arg.app).toBe('carehub')
  })

  it('injects its service-role client into shared-email', () => {
    // Shared-email cannot resolve '@supabase/supabase-js' from its own
    // directory on Vercel, so a handler that forgets to pass the client
    // reintroduces the "Cannot find package" crash on every reset click.
    sendAuthEmail.mockResolvedValue({ ok: true, sent: true })
    const res = { statusCode: 0, body: null }
    res.status = (c) => { res.statusCode = c; return res }
    res.json = (b) => { res.body = b; return res }
    return handler({ method: 'POST', body: { action: 'password_reset', email: 'user@example.com' } }, res)
      .then(() => {
        expect(sendAuthEmail.mock.calls[0][0].supabase).toBe(supabase)
      })
  })

  it('does not perform its own account lookup', async () => {
    // The existence check belongs to generateLink inside shared-email. If this
    // handler queries auth by email again it must use a method that exists.
    await post({ action: 'password_reset', email: 'user@example.com' })
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('answers an unknown address exactly like a known one, so the endpoint cannot enumerate accounts', async () => {
    sendAuthEmail.mockResolvedValue({ ok: true, sent: true })
    const known = await post({ action: 'password_reset', email: 'user@example.com' })
    sendAuthEmail.mockResolvedValue({ ok: true, sent: false })
    const unknown = await post({ action: 'password_reset', email: 'nobody@nowhere.invalid' })

    // `sent: false` used to be returned here and meant "no such account"; any difference between these two responses
    // is an account-existence oracle.
    expect(unknown.statusCode).toBe(known.statusCode)
    expect(unknown.body).toEqual(known.body)
  })

  it('still answers a generic 200 when dispatch throws', async () => {
    sendAuthEmail.mockRejectedValue(new Error('SMTP down'))
    const res = await post({ action: 'password_reset', email: 'user@example.com' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('passes a display-name resolver that prefers the profile, then the business owner', async () => {
    await post({ action: 'password_reset', email: 'user@example.com' })
    const { resolveDisplayName } = sendAuthEmail.mock.calls[0][0]
    expect(typeof resolveDisplayName).toBe('function')

    supabase.from = vi.fn((t) =>
      t === 'profiles'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => thenable({ data: { full_name: 'Ada Lovelace' }, error: null }) }) }) }
        : { select: () => ({ ilike: () => ({ maybeSingle: () => thenable({ data: { owner_name: 'Grace H' }, error: null }) }) }) }
    )

    await expect(resolveDisplayName({ id: 'user-1' })).resolves.toBe('Ada Lovelace')
    await expect(resolveDisplayName(null)).resolves.toBe('')
  })

  it('falls back to the business owner when the profile is missing', async () => {
    await post({ action: 'password_reset', email: 'user@example.com' })
    const { resolveDisplayName } = sendAuthEmail.mock.calls[0][0]

    supabase.from = vi.fn((t) =>
      t === 'profiles'
        ? { select: () => ({ eq: () => ({ maybeSingle: () => thenable({ data: null, error: null }) }) }) }
        : { select: () => ({ ilike: () => ({ maybeSingle: () => thenable({ data: { owner_name: 'Grace H' }, error: null }) }) }) }
    )
    await expect(resolveDisplayName({ id: 'user-1' })).resolves.toBe('Grace H')
  })

  it('treats a query error as a missing name instead of throwing', async () => {
    // supabase-js reports query failures in { error } rather than throwing.
    await post({ action: 'password_reset', email: 'user@example.com' })
    const { resolveDisplayName } = sendAuthEmail.mock.calls[0][0]
    supabase.from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => thenable({ data: null, error: { message: 'boom' } }) }), ilike: () => ({ maybeSingle: () => thenable({ data: null, error: { message: 'boom' } }) }) }),
    }))
    await expect(resolveDisplayName({ id: 'user-1' })).resolves.toBe('')
  })

  it('never calls an admin method that supabase-js does not implement', () => {
    // The real SDK is resolvable from this app, unlike in shared-email, so this
    // asserts the handler's source against the actual admin surface. A stubbed
    // client would have accepted the phantom method that caused the outage.
    const admin = createClient('http://localhost', 'x'.repeat(40)).auth.admin
    const real = new Set(
      Object.getOwnPropertyNames(Object.getPrototypeOf(admin)).filter((n) => n !== 'constructor')
    )
    expect(real.has('getUserByEmail')).toBe(false)

    const source = readFileSync(resolve(process.cwd(), 'api/_handlers/auth-email.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(source).not.toMatch(/getUserByEmail/)
    const called = [...source.matchAll(/auth\.admin\.(\w+)/g)].map((m) => m[1])
    for (const method of called) {
      expect(real.has(method), `auth.admin.${method} is not a real supabase-js method`).toBe(true)
    }
  })
})
