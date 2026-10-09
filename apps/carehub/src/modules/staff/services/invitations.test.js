import { describe, it, expect, vi } from 'vitest'
import { createInvitationService, readableError } from './invitations.js'

function harness({ status = 200, body = { invitation: { email: 'ada@x.com' }, email_sent: true }, session = { access_token: 'jwt-1' } } = {}) {
  const calls = []
  const fetchImpl = vi.fn(async (url, options) => {
    calls.push({ url, options })
    return { ok: status < 400, status, json: async () => body }
  })
  const request = vi.fn(async () => ({ state: 'valid' }))
  const service = createInvitationService({
    fetchImpl,
    getSession: async () => ({ data: { session } }),
    request,
  })
  return { service, calls, request }
}

describe('invite', () => {
  it('posts a normalised invite to the server endpoint with the session token', async () => {
    const { service, calls } = harness()
    const result = await service.invite('biz-1', { fullName: ' Ada Obi ', email: ' Ada@X.com ', role: 'Cashier', showOnCareFind: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/staff-invitations')
    expect(calls[0].options.headers.Authorization).toBe('Bearer jwt-1')
    expect(JSON.parse(calls[0].options.body)).toEqual({
      action: 'invite', business_id: 'biz-1', full_name: 'Ada Obi', email: 'ada@x.com',
      role: 'Cashier', phone: '', show_on_carefind: true, public_title: '',
    })
    expect(result).toEqual({ invitation: { email: 'ada@x.com' }, emailSent: true })
  })

  it('never sends a password — the invitee chooses their own', async () => {
    const { service, calls } = harness()
    await service.invite('biz-1', { fullName: 'A', email: 'a@x.com', role: 'Cashier', password: 'owner-chosen' })
    expect(calls[0].options.body).not.toContain('owner-chosen')
    expect(JSON.parse(calls[0].options.body)).not.toHaveProperty('password')
  })

  it("surfaces the server's reason verbatim", async () => {
    const { service } = harness({ status: 400, body: { error: "This email is a business owner's CareHub login." } })
    await expect(service.invite('biz-1', { fullName: 'A', email: 'owner@x.com', role: 'Cashier' }))
      .rejects.toThrow("This email is a business owner's CareHub login.")
  })

  it('refuses to call the server without a session', async () => {
    const { service, calls } = harness({ session: null })
    await expect(service.resend('s1')).rejects.toThrow(/sign in again/)
    expect(calls).toHaveLength(0)
  })
})

describe('resend', () => {
  it('sends only the staff id', async () => {
    const { service, calls } = harness({ body: { invitation: {}, email_sent: false } })
    const result = await service.resend('s1')
    expect(JSON.parse(calls[0].options.body)).toEqual({ action: 'resend', staff_id: 's1' })
    expect(result.emailSent).toBe(false)
  })
})

describe('lookup / accept', () => {
  it('call the invitation RPCs with the raw token', async () => {
    const { service, request } = harness()
    await service.lookup('tok')
    await service.accept('tok', 'Secret123')
    await service.accept('tok')
    expect(request.mock.calls[0]).toEqual(['rpc/get_staff_invitation', { method: 'POST', body: JSON.stringify({ p_token: 'tok' }) }])
    expect(request.mock.calls[1]).toEqual(['rpc/accept_staff_invitation', { method: 'POST', body: JSON.stringify({ p_token: 'tok', p_password: 'Secret123' }) }])
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ p_token: 'tok', p_password: null })
  })
})

describe('readableError', () => {
  it('strips the transport prefix and falls back when empty', () => {
    expect(readableError(new Error('Supabase error (400): This invitation has expired.'))).toBe('This invitation has expired.')
    expect(readableError(new Error(''), 'fallback')).toBe('fallback')
    expect(readableError(null, 'fallback')).toBe('fallback')
  })
})
