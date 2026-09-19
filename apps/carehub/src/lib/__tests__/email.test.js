import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildRegistrationOwnerHtml, buildAdminNewRegistrationHtml, buildBusinessApprovedHtml, buildBusinessRejectedHtml } from '../email.js'

describe('email builders', () => {
  it('registration owner html contains business and owner names and under review', () => {
    const html = buildRegistrationOwnerHtml({ businessName: 'HealthPlus', ownerName: 'Chidi' })
    expect(html).toContain('HealthPlus')
    expect(html).toContain('Chidi')
    expect(html).toContain('under review')
    expect(html).toContain('24 hours')
  })

  it('admin new registration html contains table rows', () => {
    const html = buildAdminNewRegistrationHtml({ businessName: 'MediCare', ownerName: 'Ada', businessType: 'pharmacy', state: 'Lagos', email: 'ada@example.com' })
    expect(html).toContain('MediCare')
    expect(html).toContain('Ada')
    expect(html).toContain('pharmacy')
    expect(html).toContain('Lagos')
    expect(html).toContain('ada@example.com')
    expect(html).toContain('New Business Registration')
  })

  it('business approved html contains welcome and login details', () => {
    const html = buildBusinessApprovedHtml({ businessName: 'Wellness Spa', ownerName: 'Emeka', ownerEmail: 'emeka@example.com' })
    expect(html).toContain('Wellness Spa')
    expect(html).toContain('Emeka')
    expect(html).toContain('emeka@example.com')
    expect(html).toContain('Approved')
  })

  it('business rejected html contains reason when provided', () => {
    const html = buildBusinessRejectedHtml({ businessName: 'X Pharmacy', ownerName: 'Bola', reason: 'Missing documents' })
    expect(html).toContain('X Pharmacy')
    expect(html).toContain('Missing documents')
  })

  it('business rejected html omits reason block when no reason', () => {
    const html = buildBusinessRejectedHtml({ businessName: 'X', ownerName: 'Y', reason: '' })
    expect(html).not.toContain('Reason:')
  })

  it('client email.js does not leak resend key', () => {
    const file = fs.readFileSync(path.resolve('src/lib/email.js'), 'utf-8')
    const key = ['RESEND','API','KEY'].join('_')
    expect(file).not.toContain(key)
    expect(file).not.toContain('api.resend.com')
  })
})
