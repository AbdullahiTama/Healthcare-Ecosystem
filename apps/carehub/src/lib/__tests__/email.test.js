import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

const getSession = vi.hoisted(() => vi.fn())
const refreshSession = vi.hoisted(() => vi.fn())
vi.mock('../authClient.js', () => ({ authClient: { auth: { getSession, refreshSession, signOut: vi.fn(async () => ({})) } } }))

import { emailAgentApproved, emailAgentRejected } from '../email.js'

describe('client email events', () => {
  beforeEach(() => {
    getSession.mockReset()
    refreshSession.mockReset()
    vi.restoreAllMocks()
  })

  it('fails honestly when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const res = await emailAgentApproved({ agentEmail: 'a@b.com', agentName: 'X' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/sign in again/i)
  })

  // A till whose clock is behind keeps an expired token; the server's 401 earns one renewal and one retry. The handler
  // refuses before mailing anything, so this cannot send twice.
  it('renews a token the server refused and sends on the retry', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'old' } } })
    refreshSession.mockResolvedValue({ data: { session: { access_token: 'new' } }, error: null })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => opts.headers.Authorization === 'Bearer new'
      ? { ok: true, status: 200, json: async () => ({}) }
      : { ok: false, status: 401, json: async () => ({ error: 'Invalid or expired session' }) })
    const res = await emailAgentApproved({ agentEmail: 'a@b.com', agentName: 'X' })
    expect(res.success).toBe(true)
    expect(spy.mock.calls.map(([, o]) => o.headers.Authorization)).toEqual(['Bearer old', 'Bearer new'])
  })

  it('posts agent_approved with an Authorization header', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
    const res = await emailAgentApproved({ agentEmail: 'a@b.com', agentName: 'X', referralCode: 'R1' })
    expect(res.success).toBe(true)
    const [url, opts] = spy.mock.calls[0]
    expect(url).toBe('/api/email/send')
    expect(opts.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body).templateKey).toBe('agent_approved')
  })

  it('posts agent_rejected and surfaces server errors', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid templateKey' }) })
    const res = await emailAgentRejected({ agentEmail: 'a@b.com', agentName: 'X' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('Invalid templateKey')
  })

  it('requires an agentEmail', async () => {
    expect((await emailAgentApproved({})).success).toBe(false)
    expect((await emailAgentRejected({})).success).toBe(false)
  })

  it('client email.js never references Resend directly', () => {
    const file = fs.readFileSync(path.resolve('src/lib/email.js'), 'utf-8')
    const key = ['RESEND', 'API', 'KEY'].join('_')
    expect(file).not.toContain(key)
    expect(file).not.toContain('api.resend.com')
  })
})
