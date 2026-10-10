import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import { createSecurityMailer, renderPinLockedEmail, renderOtpEmail, renderPinChangedEmail, renderPayoutAccountEmail, senderFor } from '../securityEmails.js'

describe('security emails', () => {
  it('OTP email shows the code in the body only, with the right brand and sender', () => {
    const m = renderOtpEmail({ app: 'carehub', code: '482913', minutes: 5, purpose: 'pin_set' })
    expect(m.html).toContain('482913')
    expect(m.subject).not.toContain('482913')
    expect(m.subject).toContain('CareHub')
    expect(m.from).toBe('CareHub <support@mail.carefindhub.com>')
    expect(m.html).toContain('withdrawal PIN')
    expect(m.html).toContain('Never share this code')
  })

  it('defaults to CareFind and escapes anything it interpolates', () => {
    const m = renderOtpEmail({ code: '<script>1</script>' })
    expect(m.from).toBe(senderFor('carefind'))
    expect(m.html).not.toContain('<script>1</script>')
    expect(m.html).toContain('&lt;script&gt;')
  })

  it('PIN-changed alert never contains a code and warns the reader', () => {
    const m = renderPinChangedEmail({ app: 'carefind', changedAt: '2026-10-12T10:00:00Z' })
    expect(m.html).toContain('If this was not you')
    expect(m.html).toContain('Mon, 12 Oct 2026')
  })

  it('payout account alert names the bank and last four digits only', () => {
    const m = renderPayoutAccountEmail({ app: 'carehub', event: 'removed', bankName: 'Zenith Bank', accountLast4: '4321' })
    expect(m.subject).toContain('removed')
    expect(m.html).toContain('Zenith Bank')
    expect(m.html).toContain('4321')
  })
})

describe('PIN-locked alert', () => {
  it('warns of guessing, names the pause, and carries no code or PIN', () => {
    const m = renderPinLockedEmail({ app: 'carehub', minutes: 15 })
    expect(m.subject).toContain('CareHub')
    expect(m.html).toContain('15 minutes')
    expect(m.html).toContain('If this was not you')
    expect(m.from).toBe('CareHub <support@mail.carefindhub.com>')
  })
  it('is available on the mailer', async () => {
    const send = vi.fn(async () => ({ success: true }))
    expect(await createSecurityMailer({ send }).sendPinLocked({ to: 'a@x.com' })).toEqual({ ok: true })
    expect(send.mock.calls[0][0].subject).toContain('locked')
  })
})

describe('createSecurityMailer', () => {
  it('sends through the injected transport with the app sender and reports ok', async () => {
    const send = vi.fn(async () => ({ success: true }))
    const mailer = createSecurityMailer({ app: 'carehub', send })
    expect(await mailer.sendOtp({ to: 'a@x.com', code: '123456', minutes: 5, purpose: 'pin_set' })).toEqual({ ok: true })
    const arg = send.mock.calls[0][0]
    expect(arg.to).toBe('a@x.com')
    expect(arg.from).toContain('CareHub')
    expect(arg.html).toContain('123456')
  })

  it('returns a failure instead of throwing, and leaks neither address nor code', async () => {
    const mailer = createSecurityMailer({ send: async () => ({ success: false, error: 'RESEND_API_KEY not configured' }) })
    const r = await mailer.sendPinChanged({ to: 'secret@x.com' })
    expect(r).toEqual({ ok: false, error: 'RESEND_API_KEY not configured' })
    expect(JSON.stringify(r)).not.toContain('secret@x.com')
  })
})
