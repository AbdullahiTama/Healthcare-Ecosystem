import { describe, it, expect } from 'vitest'
import { getTemplate, TEMPLATE_REGISTRY } from '../templates/index.js'
import { resolveAppFromSender } from '../EmailService.js'
import * as HubTemplates from '../templates/Transactional/index.js'
import * as FindTemplates from '../templates/Transactional/CareFind/index.js'

const SHARED_KEYS = [
  'password_reset',
  'email_verification',
  'subscription_created',
  'subscription_expiry',
  'purchase_confirmed',
  'order_status_update',
  'appointment_confirmed',
]

describe('brand-aware template registry', () => {
  it('resolves CareHub and CareFind implementations for every shared key', () => {
    for (const key of SHARED_KEYS) {
      const hub = getTemplate(key, 'carehub')
      const find = getTemplate(key, 'carefind')
      expect(hub, `carehub:${key}`).toBeTruthy()
      expect(find, `carefind:${key}`).toBeTruthy()
      expect(hub, `${key} must differ by app`).not.toBe(find)
    }
  })

  it('renders the correct brand for CareHub shared keys', () => {
    const html = getTemplate('password_reset', 'carehub')({
      fullName: 'Adebayo Johnson',
      resetLink: 'https://x/reset',
    })
    expect(html).toContain('CareHub')
    expect(html).toContain('https://carefindhub.com/logo-wordmark.png')
    expect(html).toContain('carefindhub.com/logo-wordmark.png" alt="CareHub logo"')
    expect(html).not.toContain('carefind.ng')
  })

  it('renders the correct brand for CareFind shared keys', () => {
    const html = getTemplate('email_verification', 'carefind')({
      fullName: 'Tunde Bakare',
      verifyLink: 'https://x/verify',
    })
    expect(html).toContain('CareFind')
    expect(html).toContain('https://carefind.app/logo-wordmark.png')
    expect(html).not.toContain('carefindhub.com')
  })

  it('keeps exclusive CareHub keys resolving to CareHub templates in both views', () => {
    const html = getTemplate('registration_owner', 'carehub')({
      fullName: 'Adebayo Johnson',
      businessName: 'Lifeline Pharmacy',
      email: 'a@l.ng',
    })
    expect(html).toContain('CareHub')
    expect(TEMPLATE_REGISTRY['registration_owner']).toBe(HubTemplates.customerRegistration)
  })

  it('keeps exclusive CareFind keys resolving to CareFind templates', () => {
    const html = getTemplate('customer_registration', 'carefind')({
      fullName: 'Tunde Bakare',
      email: 'tunde@carefind.ng',
    })
    expect(html).toContain('CareFind')
    expect(TEMPLATE_REGISTRY['customer_registration']).toBe(FindTemplates.customerRegistration)
  })

  it('returns null for an unknown key rather than borrowing another key', () => {
    expect(getTemplate('does_not_exist', 'carehub')).toBeNull()
    expect(getTemplate('does_not_exist', 'carefind')).toBeNull()
  })

  // The merged registry prefers CareFind, so the old cross-app fallback meant a
  // CareHub event whose CareHub template was missing resolved to the CareFind
  // renderer and quietly mailed the wrong brand. getTemplate must fail closed.
  it('does not let a CareHub row borrow the CareFind template', () => {
    expect(getTemplate('booking_confirmed', 'carehub')).toBeNull()
    expect(getTemplate('customer_registration', 'carehub')).toBeNull()
    // The mirrored direction still resolves, proving this is a fail-closed
    // change and not a broken lookup.
    expect(getTemplate('booking_confirmed', 'carefind')).toBe(FindTemplates.bookingConfirmed)
  })

  it('keeps the merged registry available for preview tooling', () => {
    // TEMPLATE_REGISTRY is still exported for listings; it is simply no longer
    // used to resolve a send, which is what made misbranding possible.
    expect(TEMPLATE_REGISTRY['registration_owner']).toBe(HubTemplates.customerRegistration)
  })
})

describe('resolveAppFromSender', () => {
  it('maps CareHub-branded senders to carehub', () => {
    expect(resolveAppFromSender('CareHub <support@mail.carefindhub.com>')).toBe('carehub')
  })
  it('maps CareFind-branded senders to carefind', () => {
    expect(resolveAppFromSender('CareFind <support@mail.carefind.app>')).toBe('carefind')
  })
  it('defaults empty senders to carefind', () => {
    expect(resolveAppFromSender(undefined)).toBe('carefind')
    expect(resolveAppFromSender('')).toBe('carefind')
  })
})

describe('transactional template branding', () => {
  it('CareHub templates use the CareHub logo and site domain', () => {
    const html = HubTemplates.emailVerification({ fullName: 'A', verifyLink: 'https://x/v' })
    expect(html).toContain('https://carefindhub.com/logo-wordmark.png')
    expect(html).toContain('carefindhub.com')
    expect(html).toContain('CareHub')
    expect(html).not.toContain('carehub.ng')
  })

  it('CareFind templates use the CareFind logo and site domain', () => {
    const html = FindTemplates.passwordReset({ fullName: 'A', resetLink: 'https://x/r' })
    expect(html).toContain('https://carefind.app/logo-wordmark.png')
    expect(html).toContain('carefind.ng')
    expect(html).toContain('CareFind')
  })
})