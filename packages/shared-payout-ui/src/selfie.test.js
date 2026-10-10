import { describe, it, expect } from 'vitest'
import { stripDataUrl, checkSelfieFile, prepareSelfie, formatKobo } from './selfie.js'

describe('selfie helpers', () => {
  it('strips the data: prefix', () => {
    expect(stripDataUrl('data:image/jpeg;base64,AAAA')).toBe('AAAA')
    expect(stripDataUrl('AAAA')).toBe('AAAA')
    expect(stripDataUrl(null)).toBe('')
  })
  it('validates the file before touching a canvas', async () => {
    expect(checkSelfieFile(null)).toMatch(/Take or choose/)
    expect(checkSelfieFile({ type: 'application/pdf', size: 10 })).toMatch(/not a photo/)
    expect(checkSelfieFile({ type: 'image/jpeg', size: 20 * 1024 * 1024 })).toMatch(/too large/)
    expect(checkSelfieFile({ type: 'image/jpeg', size: 1000 })).toBe('')
    await expect(prepareSelfie({ type: 'text/plain', size: 1 })).rejects.toThrow(/not a photo/)
  })
  it('formats kobo as naira', () => {
    expect(formatKobo(5_000_000)).toBe('₦50,000')
    expect(formatKobo(undefined)).toBe('₦0')
  })
})
