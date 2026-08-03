import { describe, it, expect } from 'vitest'
import { fmt, fmtDate, todayDate, currentMonth, genId, businessIcon, businessName } from '../utils.js'

describe('value formatting', () => {
  it('formats numbers as naira with thousands separators', () => {
    expect(fmt(1234)).toMatch(/^\u20A6/)
    expect(fmt(1234)).toContain('1,234')
  })

  it('treats zero, null and undefined as ₦0', () => {
    expect(fmt(0)).toBe('₦0')
    expect(fmt(null)).toBe('₦0')
    expect(fmt(undefined)).toBe('₦0')
  })

  it('renders an em dash for missing dates', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate(undefined)).toBe('—')
  })
})

describe('date helpers', () => {
  it('returns today as YYYY-MM-DD', () => {
    const local = new Date()
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
    expect(todayDate()).toBe(expected)
  })

  it('returns the current month as YYYY-MM', () => {
    expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/)
  })
})

describe('transaction ids', () => {
  it('generates a prefixed 6-digit id', () => {
    expect(genId('TXN')).toMatch(/^TXN\d{6}$/)
    expect(genId()).toMatch(/^TXN\d{6}$/) // defaults to the TXN prefix
    expect(genId('INV-')).toMatch(/^INV-\d{6}$/)
  })
})

describe('business taxonomy helpers', () => {
  it('resolves a known business type to its display name', () => {
    expect(businessName('pharmacy')).toBe('Community Pharmacy')
    expect(businessName('hospital')).toBe('Hospital / Clinic')
  })

  it('falls back gracefully for an unknown type', () => {
    expect(businessName('nope')).toBe('Healthcare')
    expect(businessIcon('nope')).toBeTruthy()
  })

  it('resolves an icon for known types', () => {
    expect(businessIcon('skincare')).toBeTruthy()
    expect(businessIcon('pharmacy')).toBeTruthy()
  })
})