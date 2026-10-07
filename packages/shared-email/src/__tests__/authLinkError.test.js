import { describe, it, expect, vi } from 'vitest'
import {
  detectAuthLinkError, linkExpiredUrl, readLinkExpiredParams, redirectExpiredAuthLink, LINK_EXPIRED_PATH,
} from '../authLinkError.js'

// what Supabase's /verify actually redirected to in production for an expired link (2026-10-07 auth logs: 403, then 303)
const EXPIRED_HOME = 'https://carefind.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'

function fakeWindow(href) {
  const url = new URL(href)
  const win = {
    location: { href: url.href, pathname: url.pathname },
    history: { replaceState: vi.fn((_s, _t, next) => { const u = new URL(next, url.origin); win.location.href = u.href; win.location.pathname = u.pathname }) },
  }
  return win
}

describe('detectAuthLinkError', () => {
  it('reads an expired link that landed on the home page (hash)', () => {
    expect(detectAuthLinkError(EXPIRED_HOME)).toEqual({ reason: 'expired', kind: 'auth', code: 'otp_expired' })
  })

  it('reads a PKCE error from the query and the intended page', () => {
    expect(detectAuthLinkError('https://carefindhub.com/reset-password?error=access_denied&error_code=otp_expired&error_description=x'))
      .toEqual({ reason: 'expired', kind: 'password_reset', code: 'otp_expired' })
    expect(detectAuthLinkError('https://carefind.app/verify-email#error_code=flow_state_expired'))
      .toEqual({ reason: 'expired', kind: 'email_verification', code: 'flow_state_expired' })
  })

  it('any other auth error is an invalid link', () => {
    expect(detectAuthLinkError('https://carefind.app/?error=server_error&error_description=x').reason).toBe('invalid')
    expect(detectAuthLinkError('https://carefind.app/#error_description=blocked')).toEqual({ reason: 'invalid', kind: 'auth', code: 'unknown' })
  })

  it('never carries attacker-controlled text: an odd code becomes "unknown"', () => {
    expect(detectAuthLinkError('https://carefind.app/#error_code=<script>alert(1)</script>').code).toBe('unknown')
  })

  it('a URL without an auth error, or no URL at all, is not an expired link', () => {
    expect(detectAuthLinkError('https://carefind.app/')).toBeNull()
    expect(detectAuthLinkError('https://carefind.app/reset-password?code=abc')).toBeNull()
    expect(detectAuthLinkError('https://carefind.app/#access_token=t&type=recovery')).toBeNull()
    expect(detectAuthLinkError('')).toBeNull()
  })
})

describe('linkExpiredUrl / readLinkExpiredParams', () => {
  it('round-trips', () => {
    const url = linkExpiredUrl({ reason: 'invalid', kind: 'password_reset' })
    expect(url).toBe('/link-expired?reason=invalid&kind=password_reset')
    expect(readLinkExpiredParams(url.split('?')[1])).toEqual({ reason: 'invalid', kind: 'password_reset' })
  })

  it('falls back to the defaults for anything not allow-listed', () => {
    expect(readLinkExpiredParams('?reason=hacked&kind=<b>')).toEqual({ reason: 'expired', kind: 'auth' })
    expect(readLinkExpiredParams('')).toEqual({ reason: 'expired', kind: 'auth' })
  })
})

describe('redirectExpiredAuthLink', () => {
  it('moves an expired link to /link-expired without a reload, and drops the error params', () => {
    const win = fakeWindow(EXPIRED_HOME)
    const logger = { warn: vi.fn() }
    expect(redirectExpiredAuthLink({ win, logger })).toMatchObject({ reason: 'expired' })
    expect(win.history.replaceState).toHaveBeenCalledWith(null, '', '/link-expired?reason=expired&kind=auth')
    expect(win.location.href).not.toContain('error')
    expect(logger.warn.mock.calls[0][0]).toContain('otp_expired')
  })

  it('never logs the URL (it can carry tokens)', () => {
    const win = fakeWindow('https://carefind.app/?error=x#access_token=SECRET')
    const logger = { warn: vi.fn() }
    redirectExpiredAuthLink({ win, logger })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('SECRET')
  })

  it('leaves pages that handle the error themselves, and normal URLs, alone', () => {
    const verify = fakeWindow('https://carefind.app/verify-email#error=access_denied&error_code=otp_expired')
    expect(redirectExpiredAuthLink({ win: verify, skipPaths: ['/verify-email'], logger: {} })).toBeNull()
    expect(verify.history.replaceState).not.toHaveBeenCalled()

    const normal = fakeWindow('https://carefind.app/feed')
    expect(redirectExpiredAuthLink({ win: normal, logger: {} })).toBeNull()
    expect(normal.history.replaceState).not.toHaveBeenCalled()

    const already = fakeWindow(`https://carefind.app${LINK_EXPIRED_PATH}?error=x`)
    expect(redirectExpiredAuthLink({ win: already, logger: {} })).toBeNull()
  })

  it('without a browser window it does nothing', () => {
    expect(redirectExpiredAuthLink({ win: undefined })).toBeNull()
  })
})
