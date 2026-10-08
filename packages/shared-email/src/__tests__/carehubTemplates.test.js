import { describe, it, expect } from 'vitest'
import { getTemplate } from '../templates/index.js'
import { htmlToText } from '../utils/htmlToText.js'

const TEMPLATE_KEYS = ['registration_owner', 'admin_new_registration', 'business_approved', 'business_rejected', 'appointment_confirmed', 'credit_reminder', 'staff_welcome', 'agent_approved', 'agent_rejected']

const PAYLOADS = {
  registration_owner: { businessName: 'HealthPlus Pharmacy', ownerName: 'Chidi Okafor' },
  admin_new_registration: { businessName: 'MediCare Hospital', ownerName: 'Ada Eze', businessType: 'hospital', state: 'Lagos', email: 'ada@medicare.ng' },
  business_approved: { businessName: 'Wellness Spa', ownerName: 'Emeka', ownerEmail: 'emeka@wellness.ng' },
  business_rejected: { businessName: 'X Clinic', ownerName: 'Bola', reason: 'Missing license' },
  appointment_confirmed: { fullName: 'Tunde', businessName: 'Care Clinic', service: 'Checkup', date: '2026-10-10', time: '10:00', staffName: 'Dr. A' },
  credit_reminder: { clientName: 'Ngozi', businessName: 'HealthPlus', amount: '₦5,000', dueDate: '2026-10-15' },
  staff_welcome: { fullName: 'Sade', role: 'Pharmacist', businessName: 'HealthPlus', setupLink: 'https://carefindhub.com/setup?token=abc' },
  agent_approved: { agentName: 'Kola', agentEmail: 'kola@agency.ng', referralCode: 'REF-1', city: 'Abuja', area: 'Garki' },
  agent_rejected: { agentName: 'Kemi', reason: 'Incomplete documents' },
}

describe('CareHub templates — structural guarantees', () => {
  for (const key of TEMPLATE_KEYS) {
    it(`${key}: branded, responsive shell, CTA present, footer present`, () => {
      const html = getTemplate(key, 'carehub')(PAYLOADS[key])
      expect(html).toContain('CareHub')
      expect(html).toContain('email-logo.png')
      expect(html).toContain('role="presentation"')
      expect(html).toContain('<!doctype html>')
      expect(html).toContain('All rights reserved')
      // no obsolete branding
      expect(html).not.toContain('skincarepro.vercel.app')
      // plain-text fallback works
      const text = htmlToText(html)
      expect(text.length).toBeGreaterThan(20)
    })
  }

  it('renders every template with no optional data', () => {
    for (const key of TEMPLATE_KEYS) {
      const html = getTemplate(key, 'carehub')({})
      expect(typeof html).toBe('string')
      expect(html.length).toBeGreaterThan(100)
      expect(html).not.toContain('skincarepro.vercel.app')
    }
  })

  it('escapes malicious HTML in every dynamic field', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    for (const key of TEMPLATE_KEYS) {
      const payload = Object.fromEntries(Object.keys(PAYLOADS[key]).map((k) => [k, evil]))
      const html = getTemplate(key, 'carehub')(payload)
      expect(html, key).not.toContain('<script>alert(1)</script>')
      expect(html, key).toContain('&lt;script&gt;')
    }
  })

  it('handles long names and special characters', () => {
    const longName = 'Adebayo Chukwuemeka Oluwaseun-Abiodun '.repeat(10) + 'Émile & Sons <Ltd>'
    for (const key of TEMPLATE_KEYS) {
      const payload = Object.fromEntries(Object.keys(PAYLOADS[key]).map((k) => [k, longName]))
      const html = getTemplate(key, 'carehub')(payload)
      expect(html).toContain('&amp;')
      expect(html).not.toContain('<Ltd>')
    }
  })

  it('uses environment-configured URL, not a hardcoded skincarepro link', () => {
    const html = getTemplate('business_approved', 'carehub')(PAYLOADS.business_approved)
    expect(html).not.toContain('skincarepro.vercel.app')
    expect(html).not.toContain('localhost')
  })

  it('never renders passwords', () => {
    for (const key of TEMPLATE_KEYS) {
      const html = getTemplate(key, 'carehub')({ ...PAYLOADS[key], password: 'secret123' })
      expect(html).not.toContain('secret123')
    }
  })
})
