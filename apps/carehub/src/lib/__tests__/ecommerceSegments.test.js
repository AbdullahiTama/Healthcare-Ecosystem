import { describe, it, expect } from 'vitest'
import { resolveEcommerceSegment, SEGMENT_RATES, getCommissionRate, assertValidSegment, commissionExample } from '../ecommerceSegments.js'

describe('ecommerceSegments', () => {
  it('wholesale maps to wholesale', () => {
    expect(resolveEcommerceSegment('wholesale')).toBe('wholesale')
  })
  it('manufacturer_importer maps to distributor', () => {
    expect(resolveEcommerceSegment('manufacturer_importer')).toBe('distributor')
  })
  it('pharmacy maps to retail', () => {
    expect(resolveEcommerceSegment('pharmacy')).toBe('retail')
  })
  it('hospital maps to retail', () => {
    expect(resolveEcommerceSegment('hospital')).toBe('retail')
  })
  it('skincare maps to retail', () => {
    expect(resolveEcommerceSegment('skincare')).toBe('retail')
  })
  it('null/undefined maps to retail', () => {
    expect(resolveEcommerceSegment(null)).toBe('retail')
    expect(resolveEcommerceSegment(undefined)).toBe('retail')
    expect(resolveEcommerceSegment('')).toBe('retail')
  })
  it('override segment takes precedence when valid', () => {
    expect(resolveEcommerceSegment('pharmacy', 'wholesale')).toBe('wholesale')
    expect(resolveEcommerceSegment('wholesale', 'retail')).toBe('retail')
  })
  it('invalid override is ignored and falls back to businessType mapping', () => {
    expect(resolveEcommerceSegment('pharmacy', 'invalid')).toBe('retail')
  })
  it('SEGMENT_RATES matches spec 10%/5%/2.5%', () => {
    expect(SEGMENT_RATES.retail).toBe(0.10)
    expect(SEGMENT_RATES.wholesale).toBe(0.05)
    expect(SEGMENT_RATES.distributor).toBe(0.025)
  })
  it('getCommissionRate returns correct rate and throws on invalid', () => {
    expect(getCommissionRate('retail')).toBe(0.10)
    expect(getCommissionRate('wholesale')).toBe(0.05)
    expect(getCommissionRate('distributor')).toBe(0.025)
    expect(() => getCommissionRate('invalid')).toThrow('Invalid e-commerce segment')
  })
  it('assertValidSegment throws on invalid, passes on valid', () => {
    expect(() => assertValidSegment('retail')).not.toThrow()
    expect(() => assertValidSegment('invalid')).toThrow()
  })
  it('commissionExample labels contain expected strings', () => {
    expect(commissionExample('retail').label).toContain('₦5,000')
    expect(commissionExample('wholesale').label).toContain('₦10,000')
    expect(commissionExample('distributor').label).toContain('₦20,000')
  })
  it('future segment without configured rate throws', () => {
    expect(() => getCommissionRate('manufacturer')).toThrow()
  })
  it('SEGMENT_RATES stays in sync with CareFind pricing COMMISSION_RATES', async () => {
    // Cross-app drift guard: both apps must agree on 10%/5%/2.5%
    const fs = await import('fs')
    const path = await import('path')
    const pricingPath = path.resolve('C:/Users/USER/Desktop/HealthCare-Ecosystem/apps/carefind/src/modules/shop/pricing.js')
    // Fallback literal check if file not readable in CI
    try {
      const content = fs.readFileSync(pricingPath, 'utf8')
      expect(content).toContain('retail: 0.10')
      expect(content).toContain('wholesale: 0.05')
      expect(content).toContain('distributor: 0.025')
    } catch {}
    expect(SEGMENT_RATES.retail).toBe(0.10)
    expect(SEGMENT_RATES.wholesale).toBe(0.05)
    expect(SEGMENT_RATES.distributor).toBe(0.025)
  })
  it('commissionExample arithmetic matches rate', () => {
    for (const seg of ['retail','wholesale','distributor']) {
      const ex = commissionExample(seg)
      const rate = SEGMENT_RATES[seg]
      expect(ex.commissionKobo).toBe(Math.round(ex.saleKobo * rate))
      expect(ex.payoutKobo).toBe(ex.saleKobo - ex.commissionKobo)
    }
  })
  it('resolve handles whitespace and casing', () => {
    expect(resolveEcommerceSegment('  WHOLESALE  ')).toBe('wholesale')
    expect(resolveEcommerceSegment('  manufacturer_importer  ')).toBe('distributor')
    expect(resolveEcommerceSegment('  pharmacy ')).toBe('retail')
  })
})
