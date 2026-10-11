// H05: the payment and security e-mails, as a contract. Every template the money flows send renders for its brand, escapes
// whatever a caller (or an attacker who controls a name or a reference) puts in, shows a bank account as its last four digits
// and nothing more, and can never be made to print a code, a PIN, a password or a key. The retired OTP template is gone.
import { describe, it, expect, vi } from 'vitest'
import { getTemplate, TEMPLATE_REGISTRY } from '../templates/index.js'
import { maskAccount } from '../utils/formatters.js'
import { renderPinResetEmail, renderPinChangedEmail, createSecurityMailer, renderPayoutAccountEmail } from '../securityEmails.js'
import { EMAIL_EVENTS, isKnownEvent } from '../events.js'

const FULL_ACCOUNT = '0123456789'
const HOSTILE = '<script>alert(1)</script>'
const IMG = '"><img src=x onerror=alert(2)>'

const SECRETS = { code: '482913', otp: '735190', pin: '4821', password: 'hunter2-secret', apiKey: 'sk_live_SECRETVALUE', token: 'tok_SECRETVALUE', secret: 'whsec_SECRETVALUE' }

const PAYLOAD = {
  fullName: HOSTILE, businessName: HOSTILE, amount: '₦5,000', coins: '10', reference: IMG, purpose: HOSTILE, reason: HOSTILE,
  bankName: HOSTILE, accountNumber: FULL_ACCOUNT, outcome: 'verified', newBalance: '₦9,000',
}

const FIND_KEYS = ['payment_success', 'payment_failed', 'withdrawal_requested', 'withdrawal_processing', 'withdrawal_completed', 'withdrawal_failed',
  'refund_requested', 'refund_completed', 'refund_failed', 'wallet_needs_attention', 'payout_account_review']
const HUB_KEYS = ['payment_failed', 'withdrawal_requested', 'withdrawal_processing', 'withdrawal_completed', 'withdrawal_failed',
  'refund_requested', 'refund_completed', 'refund_failed', 'business_wallet_topup', 'payout_account_review']

const render = (key, app, payload) => String(getTemplate(key, app)(payload))

describe('every payment template exists for the brand that sends it', () => {
  it.each(FIND_KEYS)('carefind: %s', (key) => {
    expect(typeof getTemplate(key, 'carefind')).toBe('function')
  })
  it.each(HUB_KEYS)('carehub: %s', (key) => {
    expect(typeof getTemplate(key, 'carehub')).toBe('function')
  })

  it('the retired OTP template is not registered for either app (a code must never be stored in the outbox)', () => {
    expect(getTemplate('withdrawal_pin_otp', 'carefind')).toBeNull()
    expect(getTemplate('withdrawal_pin_otp', 'carehub')).toBeNull()
    expect(Object.keys(TEMPLATE_REGISTRY).filter((k) => /otp|pin_code|verification_code/i.test(k))).toEqual([])
  })

  it('the new events are in the event registry', () => {
    for (const e of ['WITHDRAWAL_PROCESSING', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'REFUND_FAILED']) {
      expect(EMAIL_EVENTS[e]).toBe(e)
      expect(isKnownEvent(e)).toBe(true)
    }
  })
})

describe('hostile input is escaped, and an account number is never shown in full', () => {
  const cases = [
    ...FIND_KEYS.map((k) => ['carefind', k]),
    ...HUB_KEYS.map((k) => ['carehub', k]),
  ]

  it.each(cases)('%s / %s', (app, key) => {
    const html = render(key, app, PAYLOAD)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x onerror')
    expect(html).not.toContain(FULL_ACCOUNT)
    expect(html.length).toBeGreaterThan(500)
  })

  it('templates that show an account show exactly the last four digits, however it arrived', () => {
    for (const accountNumber of [FULL_ACCOUNT, '••••6789', '******6789', '0123456789 ']) {
      const html = render('withdrawal_completed', 'carefind', { ...PAYLOAD, fullName: 'Ada', bankName: 'GTBank', accountNumber })
      expect(html).toContain('••••6789')
      expect(html).not.toContain(FULL_ACCOUNT)
    }
    const hub = render('withdrawal_requested', 'carehub', { businessName: 'Clinic', bankName: 'GTBank', accountNumber: FULL_ACCOUNT, amount: '₦1', reference: 'r' })
    expect(hub).toContain('••••6789')
    expect(hub).not.toContain(FULL_ACCOUNT)
  })

  it('maskAccount: total and idempotent', () => {
    expect(maskAccount('0123456789')).toBe('••••6789')
    expect(maskAccount('••••6789')).toBe('••••6789')
    expect(maskAccount(maskAccount('0123456789'))).toBe('••••6789')
    expect(maskAccount('12')).toBe('••••')
    expect(maskAccount(undefined)).toBe('')
    expect(maskAccount(null)).toBe('')
    expect(maskAccount({})).toBe('')
  })
})

describe('no secret field can reach a rendered payment e-mail', () => {
  const all = [...FIND_KEYS.map((k) => ['carefind', k]), ...HUB_KEYS.map((k) => ['carehub', k])]
  it.each(all)('%s / %s ignores code, otp, pin, password and key fields', (app, key) => {
    const html = render(key, app, { fullName: 'Ada', businessName: 'Clinic', amount: '₦1', reference: 'r', ...SECRETS })
    for (const v of Object.values(SECRETS)) expect(html).not.toContain(v)
  })
})

describe('the security mails', () => {
  const FROM = /@mail\.carefind(hub)?\.(app|com)/

  it('a PIN RESET is announced louder than a change, names the precaution, and carries no PIN', () => {
    const reset = renderPinResetEmail({ app: 'carefind', changedAt: new Date('2026-10-10T12:00:00Z') })
    const changed = renderPinChangedEmail({ app: 'carefind', changedAt: new Date('2026-10-10T12:00:00Z') })
    expect(reset.subject).toMatch(/reset/i)
    expect(reset.html).toContain('without entering the old PIN')
    expect(reset.html).toContain('limited for the next 24 hours')
    expect(reset.html).not.toMatch(/PIN[^<]{0,20}\b\d{4,6}\b/) // the PIN itself is never in the message
    expect(changed.html).not.toContain('without entering the old PIN')
    expect(reset.from).toMatch(FROM)
  })

  it('the mailer delivers a reset through its own method, both brands', async () => {
    const send = vi.fn(async () => ({ success: true }))
    for (const app of ['carefind', 'carehub']) {
      const m = createSecurityMailer({ app, send })
      expect(await m.sendPinReset({ to: 'a@example.com' })).toEqual({ ok: true })
    }
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0].subject).toMatch(/CareFind/)
    expect(send.mock.calls[1][0].subject).toMatch(/CareHub/)
  })

  it('a payout account alert shows the bank and last four digits only, also for the default-account event', () => {
    for (const event of ['added', 'removed', 'default']) {
      const m = renderPayoutAccountEmail({ app: 'carefind', event, bankName: 'GTBank', accountLast4: '6789' })
      expect(m.html).toContain('6789')
      expect(m.html).not.toMatch(/\d{10}/)
    }
  })
})
