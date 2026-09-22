import { describe, it, expect } from 'vitest'
import { parseVerifyEmailParams } from '../verifyEmailParams'

describe('parseVerifyEmailParams', () => {
  it('extracts the PKCE code from the search string', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?code=abc123')
    expect(p.code).toBe('abc123')
    expect(p.accessToken).toBeNull()
    expect(p.type).toBeNull()
    expect(p.error).toBeNull()
    expect(p.errorDescription).toBeNull()
  })

  it('extracts access_token and type from the hash fragment', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email#access_token=tok123&type=signup')
    expect(p.accessToken).toBe('tok123')
    expect(p.type).toBe('signup')
    expect(p.code).toBeNull()
  })

  it('extracts error and error_description from the hash fragment', () => {
    const p = parseVerifyEmailParams(
      'http://localhost:3000/verify-email#error=access_denied&error_description=The%20link%20you%20used%20is%20invalid%20or%20has%20expired'
    )
    expect(p.error).toBe('access_denied')
    expect(p.errorDescription).toBe('The link you used is invalid or has expired')
  })

  it('keeps search code and hash params independent', () => {
    const p = parseVerifyEmailParams(
      'http://localhost:3000/verify-email?code=pkce123#access_token=tok&type=signup&error=x&error_description=y'
    )
    expect(p.code).toBe('pkce123')
    expect(p.accessToken).toBe('tok')
    expect(p.type).toBe('signup')
    expect(p.error).toBe('x')
    expect(p.errorDescription).toBe('y')
  })

  it('returns all-null defaults for a malformed href without throwing', () => {
    const p = parseVerifyEmailParams('not a url at all')
    expect(p.code).toBeNull()
    expect(p.accessToken).toBeNull()
    expect(p.type).toBeNull()
    expect(p.error).toBeNull()
    expect(p.errorDescription).toBeNull()
  })

  it('handles an empty href (no window/SSR) without throwing', () => {
    const p = parseVerifyEmailParams('')
    expect(p.code).toBeNull()
    expect(p.accessToken).toBeNull()
    expect(p.type).toBeNull()
  })
})
