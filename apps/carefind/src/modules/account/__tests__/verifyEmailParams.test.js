import { describe, it, expect, vi } from 'vitest'
import {
  parseVerifyEmailParams,
  consumedUrlFromHref,
  AUTH_QUERY_KEYS,
  AUTH_HASH_KEYS,
  PKCE_AUX_QUERY_KEYS,
} from '../verifyEmailParams'

describe('auth-param key lists (single source of truth)', () => {
  it('declares the PKCE query keys and the implicit hash keys', () => {
    expect(AUTH_QUERY_KEYS).toEqual(['code'])
    expect(AUTH_HASH_KEYS).toEqual(['access_token', 'type', 'error', 'error_description'])
    expect(PKCE_AUX_QUERY_KEYS).toEqual(['sb_flow_id'])
  })
})

describe('parseVerifyEmailParams', () => {
  it('extracts the PKCE code from the search string and records presence', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?code=abc123')
    expect(p.code).toBe('abc123')
    expect(p.hasCode).toBe(true)
    expect(p.accessToken).toBeNull()
    expect(p.hasAccessToken).toBe(false)
    expect(p.type).toBeNull()
    expect(p.error).toBeNull()
    expect(p.errorDescription).toBeNull()
    expect(p.href).toBe('http://localhost:3000/verify-email?code=abc123')
  })

  it('extracts access_token and type from the hash fragment', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email#access_token=tok123&type=signup')
    expect(p.accessToken).toBe('tok123')
    expect(p.hasAccessToken).toBe(true)
    expect(p.type).toBe('signup')
    expect(p.hasType).toBe(true)
    expect(p.code).toBeNull()
    expect(p.hasCode).toBe(false)
  })

  it('extracts error and error_description from the hash fragment', () => {
    const p = parseVerifyEmailParams(
      'http://localhost:3000/verify-email#error=access_denied&error_description=The%20link%20you%20used%20is%20invalid%20or%20has%20expired'
    )
    expect(p.error).toBe('access_denied')
    expect(p.hasError).toBe(true)
    expect(p.errorDescription).toBe('The link you used is invalid or has expired')
    expect(p.hasErrorDescription).toBe(true)
  })

it('is presence-based, not truthiness-based: empty params still count as present', () => {
    const emptyCode = parseVerifyEmailParams('http://localhost:3000/verify-email?code=')
    expect(emptyCode.code).toBe('')
    expect(emptyCode.hasCode).toBe(true)

    const emptyToken = parseVerifyEmailParams('http://localhost:3000/verify-email#access_token=')
    expect(emptyToken.accessToken).toBe('')
    expect(emptyToken.hasAccessToken).toBe(true)

    const emptyError = parseVerifyEmailParams('http://localhost:3000/verify-email?error=')
    expect(emptyError.error).toBe('')
    expect(emptyError.hasError).toBe(true)
  })

  it('prefers the non-empty location over an empty placeholder when error spans query and hash', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?error=#error=access_denied')
    expect(p.error).toBe('access_denied')
    expect(p.hasError).toBe(true)
  })

  it('prefers the non-empty error_description while an empty placeholder sits in the other location', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?error_description=#error_description=blocked')
    expect(p.errorDescription).toBe('blocked')
    expect(p.hasErrorDescription).toBe(true)
  })

  it('keeps an empty-but-present error when neither location holds a value', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?error=')
    expect(p.error).toBe('')
    expect(p.hasError).toBe(true)
  })

  it('error_description can arrive without an error param', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?error_description=blocked')
    expect(p.errorDescription).toBe('blocked')
    expect(p.hasErrorDescription).toBe(true)
    expect(p.error).toBeNull()
    expect(p.hasError).toBe(false)
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

  it('reads an error param from the query string as well as the hash', () => {
    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?error=oauth_failed&error_description=Nope')
    expect(p.error).toBe('oauth_failed')
    expect(p.hasError).toBe(true)
    expect(p.errorDescription).toBe('Nope')
  })

  it('returns all-null defaults for a malformed href without throwing', () => {
    const p = parseVerifyEmailParams('not a url at all')
    expect(p.code).toBeNull()
    expect(p.hasCode).toBe(false)
    expect(p.accessToken).toBeNull()
    expect(p.hasAccessToken).toBe(false)
    expect(p.error).toBeNull()
    expect(p.errorDescription).toBeNull()
  })

  it('handles an empty href (no window/SSR) without throwing', () => {
    const p = parseVerifyEmailParams('')
    expect(p.href).toBeNull()
    expect(p.code).toBeNull()
    expect(p.accessToken).toBeNull()
    expect(p.type).toBeNull()
  })
})

describe('consumedUrlFromHref', () => {
  it('implicit: drops the ENTIRE hash (matches auth-js `window.location.hash = ""`)', () => {
    const href = 'http://localhost:3000/verify-email#access_token=tok&expires_in=3600&refresh_token=rt&token_type=bearer&type=signup'
    expect(consumedUrlFromHref(href)).toBe('http://localhost:3000/verify-email')
  })

  it('implicit: drops the whole hash even when it holds only auxiliary params', () => {
    expect(consumedUrlFromHref('http://localhost:3000/verify-email#type=signup')).toBe('http://localhost:3000/verify-email')
  })

  it('PKCE: strips ONLY code (+ sb_flow_id), keeping unrelated query params', () => {
    expect(consumedUrlFromHref('http://localhost:3000/verify-email?code=abc&state=xyz')).toBe(
      'http://localhost:3000/verify-email?state=xyz'
    )
    expect(consumedUrlFromHref('http://localhost:3000/verify-email?code=abc&sb_flow_id=f1&state=xyz')).toBe(
      'http://localhost:3000/verify-email?state=xyz'
    )
  })

  it('PKCE: a bare code-only query strips to the bare URL', () => {
    expect(consumedUrlFromHref('http://localhost:3000/verify-email?code=abc')).toBe('http://localhost:3000/verify-email')
  })

  it('a tokenless/bare URL is its own consumed form (no-op)', () => {
    expect(consumedUrlFromHref('http://localhost:3000/verify-email')).toBe('http://localhost:3000/verify-email')
  })

  it('returns null for a malformed href', () => {
    expect(consumedUrlFromHref('not a url at all')).toBeNull()
  })
})

describe('capturedVerifyEmailParams (import-time capture)', () => {
  it('snapshots a token-bearing URL at module evaluation, ahead of any effect', async () => {
    window.history.replaceState(null, '', 'http://localhost:3000/verify-email?code=atEval')
    vi.resetModules()
    const capture = await import('../verifyEmailParams')
    expect(capture.capturedVerifyEmailParams.code).toBe('atEval')
    expect(capture.capturedVerifyEmailParams.hasCode).toBe(true)
    expect(capture.capturedVerifyEmailParams.href).toBe('http://localhost:3000/verify-email?code=atEval')
    window.history.replaceState(null, '', 'http://localhost:3000/verify-email')
  })

  it('captures a bare URL (no window token) as an empty snapshot', async () => {
    window.history.replaceState(null, '', 'http://localhost:3000/verify-email')
    vi.resetModules()
    const capture = await import('../verifyEmailParams')
    expect(capture.capturedVerifyEmailParams.code).toBeNull()
    expect(capture.capturedVerifyEmailParams.hasCode).toBe(false)
    expect(capture.capturedVerifyEmailParams.hasAccessToken).toBe(false)
  })
})