import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import handler from '../_handlers/auth-email.js'

// This handler carried the same `supabase.auth.admin.getUserByEmail` call that
// 500'd CareHub in production. It also differs from CareHub's copy: it accepts
// customer_registration, has no action allowlist of its own, and has no
// businesses fallback for the display name.

const sendAuthEmail = vi.fn()
// supabase-js query builders are thenables, not Promises. A stub whose
// maybeSingle() returned a real Promise would expose a .catch() and so hide the
// production TypeError; this mirrors the real shape instead.
const thenable = (value) => ({ then: (onOk, onErr) => Promise.resolve(value).then(onOk, onErr) })
const table = { select: () => table, eq: () => table, maybeSingle: () => thenable({ data: null, error: null }) }
const supabase = { from: () => table, auth: { admin: {} } }

vi.mock('@supabase/supabase-js', () => ({ createClient: () => supabase }))
vi.mock('@care-ecosystem/shared-email', () => ({ sendAuthEmail: (...a) => sendAuthEmail(...a) }))

const call = async (req) => {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  await handler(req, res)
  return res
}
const post = (body) => call({ method: 'POST', body })

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key'
  sendAuthEmail.mockReset().mockResolvedValue({ ok: true, sent: true })
})

afterEach(() => vi.restoreAllMocks())

describe('/api/auth-email (carefind)', () => {
  it('rejects non-POST and malformed input', async () => {
    expect((await call({ method: 'GET', body: {} })).statusCode).toBe(405)
    expect((await post({ action: 'password_reset' })).statusCode).toBe(400)
    expect((await post({ action: 'password_reset', email: 'nope' })).statusCode).toBe(400)
    expect(sendAuthEmail).not.toHaveBeenCalled()
  })

  it('injects its service-role client into shared-email', async () => {
    // Shared-email cannot resolve '@supabase/supabase-js' from its own
    // directory on Vercel, so a handler that forgets to pass the client
    // reintroduces the "Cannot find package" crash on every reset click.
    await post({ action: 'password_reset', email: 'user@example.com' })
    expect(sendAuthEmail.mock.calls[0][0].supabase).toBe(supabase)
  })

  it('brands as carefind and leaves the redirect to shared-email', async () => {
    // The handler no longer decides where a recovery link lands. shared-email
    // derives it from APP_URL plus a fixed path, so the token can never be
    // steered at a caller-chosen host.
    const res = await post({ action: 'password_reset', email: 'user@example.com' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, sent: true })
    expect(sendAuthEmail.mock.calls[0][0]).toMatchObject({
      action: 'password_reset',
      email: 'user@example.com',
      app: 'carefind',
    })
    expect(sendAuthEmail.mock.calls[0][0]).not.toHaveProperty('redirectTo')
  })

  it('ignores a caller-supplied redirectTo', async () => {
    // generateLink mints the recovery token into redirect_to. Forwarding this
    // field is the open-redirect/account-takeover path, so none of these may
    // reach the link generator.
    const hostile = [
      'https://evil.example/steal',
      'https://carefind.app.evil.example/',
      '//evil.example',
      'https://carefind.app@evil.example',
      'javascript:alert(1)',
    ]
    for (const redirectTo of hostile) {
      sendAuthEmail.mockClear()
      await post({ action: 'password_reset', email: 'user@example.com', redirectTo })
      expect(sendAuthEmail.mock.calls[0][0]).not.toHaveProperty('redirectTo')
    }
  })

  it('still forwards customer_registration, which this app allows', async () => {
    const res = await post({ action: 'customer_registration', email: 'new@example.com' })
    expect(res.statusCode).toBe(200)
    expect(sendAuthEmail.mock.calls[0][0].action).toBe('customer_registration')
  })

  it('leaves action validation to shared-email', async () => {
    // Unlike CareHub, this handler has no allowlist, so an unknown action is
    // delegated rather than rejected with a 400.
    const res = await post({ action: 'sneeze', email: 'user@example.com' })
    expect(res.statusCode).toBe(200)
    expect(sendAuthEmail).toHaveBeenCalledTimes(1)
  })

  it('answers a generic 200 when the address is unknown or dispatch fails', async () => {
    sendAuthEmail.mockResolvedValue({ ok: true, sent: false })
    expect((await post({ action: 'password_reset', email: 'nobody@nowhere.invalid' })).body)
      .toEqual({ ok: true, sent: false })

    sendAuthEmail.mockRejectedValue(new Error('SMTP down'))
    const res = await post({ action: 'password_reset', email: 'user@example.com' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, sent: false })
  })

  it('resolves the display name from the profile only', async () => {
    await post({ action: 'password_reset', email: 'user@example.com' })
    const { resolveDisplayName } = sendAuthEmail.mock.calls[0][0]

    supabase.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: () => thenable({ data: { full_name: 'Ada Lovelace' }, error: null }) }) }) })
    await expect(resolveDisplayName({ id: 'user-1' })).resolves.toBe('Ada Lovelace')

    supabase.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: () => thenable({ data: null, error: null }) }) }) })
    await expect(resolveDisplayName({ id: 'user-1' })).resolves.toBe('')
    await expect(resolveDisplayName(undefined)).resolves.toBe('')
  })

  it('treats a query error as a missing name instead of throwing', async () => {
    // supabase-js reports query failures in { error } rather than throwing.
    await post({ action: 'password_reset', email: 'user@example.com' })
    const { resolveDisplayName } = sendAuthEmail.mock.calls[0][0]
    supabase.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: () => thenable({ data: null, error: { message: 'boom' } }) }) }) })
    await expect(resolveDisplayName({ id: 'user-1' })).resolves.toBe('')
  })

  it('never calls an admin method that supabase-js does not implement', () => {
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
