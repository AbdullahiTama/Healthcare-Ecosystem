import { describe, it, expect } from 'vitest'
import { businessSections, planSummary, BUSINESS_FULL_EXPORT_COLUMNS } from '../businessRecord'
import { flattenSections } from '../../shared/RecordFields'
import { toCsv } from '../../../../lib/carefindhubExports'

const NOW = new Date('2026-11-02T10:00:00Z')
const biz = { id: 'b1', name: 'Ada Pharmacy', owner_name: 'Ada', email: 'ada@x.com', phone: '0801', whatsapp: '0802', address: '1 Main St', city: 'Ikeja', lga: 'Ikeja', state: 'Lagos', area: 'Allen', business_type: 'pharmacy', status: 'active', plan: 'growth', plan_expires_at: '2026-11-10T00:00:00Z', visible_on_carefind: true, ecommerce_enabled: false, latitude: 6.6, longitude: 3.35, online_consultation_fee: 5000, created_at: '2026-08-01T00:00:00Z', referral_code_used: 'MUSA1' }

describe('business record', () => {
  it('shows the complete profile in sections', () => {
    const f = Object.fromEntries(flattenSections(businessSections(biz, { now: NOW })))
    expect(f['Owner and contact: WhatsApp']).toBe('0802')
    expect(f['Location: LGA']).toBe('Ikeja')
    expect(f['Location: Coordinates']).toBe('6.6, 3.35')
    expect(f['Subscription: Plan']).toBe('Growth')
    expect(f['Subscription: Plan state']).toBe('Expires in 8 days')
    expect(f['CareFind and services: Visible on CareFind']).toBe('Yes')
    expect(f['CareFind and services: Online consultation fee']).toBe('₦5,000')
    expect(f['Onboarding: Referral code used']).toBe('MUSA1')
  })
  it('summarises the plan with the app rules', () => {
    expect(planSummary({ plan_expires_at: null }, NOW)).toBe('No expiry')
    expect(planSummary({ plan_expires_at: '2026-10-30T10:00:00Z' }, NOW)).toBe('Expired 3 days ago')
    expect(planSummary({ plan_expires_at: '2027-02-01T00:00:00Z' }, NOW)).toBe('Active')
  })
  it('exports full profiles', () => {
    const [header, row] = toCsv(BUSINESS_FULL_EXPORT_COLUMNS, [biz]).split('\n')
    expect(header).toContain('WhatsApp')
    expect(header).toContain('Plan expires')
    expect(row).toContain('2026-11-10')
    expect(row).toContain('MUSA1')
  })
})
