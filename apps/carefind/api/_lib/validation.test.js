import {
  isUUID, isDate, isTime, isEmail, isPositiveInt, isNonNegativeInt,
  isString, isEnum, isAmountKobo, isPagination, sanitizeString, rejectUnknownFields,
} from '../_lib/validation.js'

describe('Validation utilities', () => {
  describe('isUUID', () => {
    it('accepts valid UUIDs', () => {
      expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })
    it('rejects invalid UUIDs', () => {
      expect(isUUID('not-a-uuid')).toBe(false)
      expect(isUUID('123')).toBe(false)
      expect(isUUID(null)).toBe(false)
      expect(isUUID(undefined)).toBe(false)
      expect(isUUID(123)).toBe(false)
    })
  })

  describe('isDate', () => {
    it('accepts valid dates', () => {
      expect(isDate('2026-10-01')).toBe(true)
    })
    it('rejects invalid dates', () => {
      expect(isDate('not-a-date')).toBe(false)
      expect(isDate('2026-13-01')).toBe(false)
      expect(isDate('01-10-2026')).toBe(false)
      expect(isDate(null)).toBe(false)
    })
  })

  describe('isTime', () => {
    it('accepts valid times', () => {
      expect(isTime('09:00')).toBe(true)
      expect(isTime('23:59')).toBe(true)
    })
    it('rejects invalid times', () => {
      expect(isTime('25:00')).toBe(false)
      expect(isTime('12:60')).toBe(false)
      expect(isTime('9:00')).toBe(false)
      expect(isTime('not-a-time')).toBe(false)
    })
  })

  describe('isEmail', () => {
    it('accepts valid emails', () => {
      expect(isEmail('user@example.com')).toBe(true)
    })
    it('rejects invalid emails', () => {
      expect(isEmail('not-an-email')).toBe(false)
      expect(isEmail('user@')).toBe(false)
      expect(isEmail('@example.com')).toBe(false)
      expect(isEmail(null)).toBe(false)
    })
  })

  describe('isPositiveInt', () => {
    it('accepts positive integers', () => {
      expect(isPositiveInt(1)).toBe(true)
      expect(isPositiveInt(100)).toBe(true)
    })
    it('rejects non-positive integers', () => {
      expect(isPositiveInt(0)).toBe(false)
      expect(isPositiveInt(-1)).toBe(false)
      expect(isPositiveInt(1.5)).toBe(false)
      expect(isPositiveInt('1')).toBe(false)
    })
  })

  describe('isAmountKobo', () => {
    it('accepts valid amounts', () => {
      expect(isAmountKobo(100)).toBe(true)
      expect(isAmountKobo(1000000)).toBe(true)
    })
    it('rejects invalid amounts', () => {
      expect(isAmountKobo(0)).toBe(false)
      expect(isAmountKobo(-100)).toBe(false)
      expect(isAmountKobo(1.5)).toBe(false)
      expect(isAmountKobo(100_000_000_001)).toBe(false)
    })
  })

  describe('isPagination', () => {
    it('accepts valid pagination', () => {
      expect(isPagination({ limit: 10, offset: 0 })).toBe(true)
      expect(isPagination({})).toBe(true)
    })
    it('rejects invalid pagination', () => {
      expect(isPagination({ limit: 0 })).toBe(false)
      expect(isPagination({ limit: -1 })).toBe(false)
      expect(isPagination({ limit: 1001 })).toBe(false)
      expect(isPagination({ offset: -1 })).toBe(false)
      expect(isPagination({ limit: 'abc' })).toBe(false)
    })
  })

  describe('sanitizeString', () => {
    it('strips angle brackets and trims', () => {
      expect(sanitizeString('  <script>alert(1)</script>  ')).toBe('scriptalert(1)/script')
    })
    it('enforces max length', () => {
      expect(sanitizeString('a'.repeat(2000), { max: 100 })).toBe('a'.repeat(100))
    })
    it('returns empty string for non-strings', () => {
      expect(sanitizeString(null)).toBe('')
      expect(sanitizeString(123)).toBe('')
    })
  })

  describe('rejectUnknownFields', () => {
    it('returns extra fields', () => {
      expect(rejectUnknownFields(['a', 'b'], { a: 1, b: 2, c: 3 })).toEqual(['c'])
    })
    it('returns null when no extra fields', () => {
      expect(rejectUnknownFields(['a', 'b'], { a: 1, b: 2 })).toBeNull()
    })
  })
})
