import { describe, it, expect, vi } from 'vitest'
import crypto from 'crypto'
import { hashPin, verifyPin, randomPinSalt, isValidPin } from '../../../api/_lib/pinCrypto.js'

describe('pinCrypto', () => {
  describe('isValidPin', () => {
    it('accepts 4-6 digits', () => {
      expect(isValidPin('1234')).toBe(true)
      expect(isValidPin('12345')).toBe(true)
      expect(isValidPin('123456')).toBe(true)
    })

    it('rejects anything else', () => {
      expect(isValidPin('123')).toBe(false)
      expect(isValidPin('1234567')).toBe(false)
      expect(isValidPin('12a4')).toBe(false)
      expect(isValidPin('')).toBe(false)
      expect(isValidPin(null)).toBe(false)
      expect(isValidPin(undefined)).toBe(false)
      expect(isValidPin(1234)).toBe(false)
    })
  })

  describe('hashPin', () => {
    it('produces a 128-char hex hash', () => {
      const salt = randomPinSalt()
      expect(hashPin('1234', salt)).toMatch(/^[0-9a-f]{128}$/)
    })

    it('produces different hashes for the same pin with different salts', () => {
      const saltA = randomPinSalt()
      const saltB = randomPinSalt()
      expect(saltA).not.toBe(saltB)
      expect(hashPin('1234', saltA)).not.toBe(hashPin('1234', saltB))
    })

    it('produces the same hash for the same pin and salt', () => {
      const salt = randomPinSalt()
      expect(hashPin('1234', salt)).toBe(hashPin('1234', salt))
    })

    it('randomPinSalt returns 32 hex chars (16 bytes)', () => {
      expect(randomPinSalt()).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  describe('verifyPin', () => {
    it('is true for the correct pin', () => {
      const salt = randomPinSalt()
      const hash = hashPin('1234', salt)
      expect(verifyPin('1234', salt, hash)).toBe(true)
    })

    it('is false for a wrong pin', () => {
      const salt = randomPinSalt()
      const hash = hashPin('1234', salt)
      expect(verifyPin('9999', salt, hash)).toBe(false)
    })

    it('is false for a malformed stored hash', () => {
      const salt = randomPinSalt()
      expect(verifyPin('1234', salt, '')).toBe(false)
      expect(verifyPin('1234', salt, 'zzz')).toBe(false)
    })

    it('uses timingSafeEqual', () => {
      const salt = randomPinSalt()
      const hash = hashPin('1234', salt)
      const spy = vi.spyOn(crypto, 'timingSafeEqual')
      try {
        expect(verifyPin('1234', salt, hash)).toBe(true)
        expect(spy).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
  })
})