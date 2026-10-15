import { describe, it, expect } from 'vitest'
import { cleanOtp, isCompleteOtp, readClipboardOtp, OTP_LENGTH } from './otpInput.js'

describe('cleanOtp', () => {
  it('strips first, truncates second, so a grouped paste lands whole', () => {
    expect(cleanOtp('123 456')).toBe('123456')
    expect(cleanOtp('123-456')).toBe('123456')
    expect(cleanOtp(' 123 456 ')).toBe('123456')
    expect(cleanOtp('Your code is 123456')).toBe('123456')
  })

  it('never returns more than six digits', () => {
    expect(cleanOtp('1234567890')).toBe('123456')
    expect(cleanOtp('1234567890')).toHaveLength(OTP_LENGTH)
  })

  it('is total: null, undefined and objects degrade to an empty string', () => {
    expect(cleanOtp(null)).toBe('')
    expect(cleanOtp(undefined)).toBe('')
    expect(cleanOtp({})).toBe('')
    expect(cleanOtp('')).toBe('')
  })

  it('keeps a leading zero (a code is a string, never a number)', () => {
    expect(cleanOtp('012345')).toBe('012345')
    expect(isCompleteOtp('012345')).toBe(true)
  })
})

describe('isCompleteOtp', () => {
  it('accepts only exactly six digits', () => {
    expect(isCompleteOtp('123456')).toBe(true)
    expect(isCompleteOtp('12345')).toBe(false)
    expect(isCompleteOtp('1234567')).toBe(false)
    expect(isCompleteOtp('')).toBe(false)
  })

  it('does not truncate before deciding, so a seven-digit paste is not reported as complete', () => {
    expect(isCompleteOtp('1234567')).toBe(false)
    expect(cleanOtp('1234567')).toBe('123456')
  })
})

describe('readClipboardOtp', () => {
  const stub = (text) => ({ readText: async () => text })

  it('reads a standalone six-digit code', async () => {
    await expect(readClipboardOtp(stub('123456'))).resolves.toBe('123456')
  })

  it('reads a grouped code, because mail clients render them with separators', async () => {
    await expect(readClipboardOtp(stub('123 456'))).resolves.toBe('123456')
  })

  it('refuses clipboard text with more than six digits, so an order or phone number is never pasted', async () => {
    await expect(readClipboardOtp(stub('Order 1234567890 confirmed'))).resolves.toBeNull()
    await expect(readClipboardOtp(stub('08012345678'))).resolves.toBeNull()
    await expect(readClipboardOtp(stub('12345'))).resolves.toBeNull()
    await expect(readClipboardOtp(stub(''))).resolves.toBeNull()
  })

  it('accepts a code surrounded by the sentence a mail client copies along with it', async () => {
    await expect(readClipboardOtp(stub('Your verification code is 123456.'))).resolves.toBe('123456')
  })

  it('refuses when the surrounding text adds digits of its own', async () => {
    await expect(readClipboardOtp(stub('Your verification code is 123456. It expires in 5 minutes.'))).resolves.toBeNull()
  })

  it('never throws when the clipboard is missing, blocked, or insecure', async () => {
    await expect(readClipboardOtp(null)).resolves.toBeNull()
    await expect(readClipboardOtp({})).resolves.toBeNull()
    await expect(readClipboardOtp({ readText: async () => { throw new Error('denied') } })).resolves.toBeNull()
  })
})