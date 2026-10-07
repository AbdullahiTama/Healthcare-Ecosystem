// Expired / invalid emailed auth links (password reset, staff invitation, email verification), for both apps.
//
// When a link's one-time token has expired or was already used, Supabase's /verify answers 403 ("Email link is invalid or
// has expired") and redirects the browser to the app with the reason in the URL, e.g.
//   https://carefind.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
// (the hash for implicit-flow links, the query for PKCE). The redirect lands on the redirect_to path when it is allow-listed,
// otherwise on the Site URL, i.e. the home page. Nothing read those params, so the user was left on the home page with no
// explanation. redirectExpiredAuthLink() runs at boot, before the Supabase client is created, and moves such a URL to the app's
// /link-expired page.
//
// Browser-safe: no Node or Supabase imports. The error_description in the URL is never shown: anyone can craft a link with
// any text in it, so the page only shows its own copy, chosen from the allow-listed reason and kind below.

export const LINK_EXPIRED_PATH = '/link-expired'

// Supabase error codes that mean "this link was good but is no longer usable" (expired, or its single use already spent)
const EXPIRED_CODES = new Set(['otp_expired', 'flow_state_expired'])

export const LINK_ERROR_REASONS = ['expired', 'invalid']
export const LINK_KINDS = ['password_reset', 'email_verification', 'auth']

// the path the link was meant for tells which email it came from; anything else (the home page) is a generic auth link
const KIND_BY_PATH = {
  '/reset-password': 'password_reset',
  '/verify-email': 'email_verification',
}

function paramsOf(url) {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const get = (key) => {
    const q = url.searchParams.get(key)
    if (q !== null && q !== '') return q
    const h = hash.get(key)
    return h !== null && h !== '' ? h : (q ?? h)
  }
  const has = (key) => url.searchParams.has(key) || hash.has(key)
  return { get, has }
}

// href -> { reason, kind, code } when the URL carries a Supabase auth error, else null
export function detectAuthLinkError(href) {
  let url
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const { get, has } = paramsOf(url)
  if (!has('error') && !has('error_code') && !has('error_description')) return null
  const code = get('error_code') || get('error') || ''
  return {
    reason: EXPIRED_CODES.has(code) ? 'expired' : 'invalid',
    kind: KIND_BY_PATH[url.pathname] || 'auth',
    code: /^[a-z0-9_]{1,64}$/.test(code) ? code : 'unknown',
  }
}

export function linkExpiredUrl({ reason, kind }) {
  const qs = new URLSearchParams({ reason, kind })
  return `${LINK_EXPIRED_PATH}?${qs.toString()}`
}

// The /link-expired page's own query, reduced to the allow-listed values (a hand-edited URL falls back to the defaults)
export function readLinkExpiredParams(search) {
  const qs = new URLSearchParams(search || '')
  const reason = qs.get('reason')
  const kind = qs.get('kind')
  return {
    reason: LINK_ERROR_REASONS.includes(reason) ? reason : 'expired',
    kind: LINK_KINDS.includes(kind) ? kind : 'auth',
  }
}

// Run once at boot, BEFORE the Supabase client is created (it reads, and on success clears, these params at createClient()).
// Rewrites the URL in place (no reload) so the router renders /link-expired. Paths in skipPaths handle the error themselves
// (CareFind's /verify-email offers to resend the verification email). Returns the detected error, or null.
export function redirectExpiredAuthLink({ win = typeof window !== 'undefined' ? window : undefined, skipPaths = [], logger = console } = {}) {
  try {
    if (!win?.location || !win?.history) return null
    if (win.location.pathname === LINK_EXPIRED_PATH) return null
    const err = detectAuthLinkError(win.location.href)
    if (!err || skipPaths.includes(win.location.pathname)) return null
    // the code only: the URL may also carry tokens, which must never reach the logs
    logger.warn?.(`[auth-link] ${err.reason} ${err.kind} link (${err.code}); showing ${LINK_EXPIRED_PATH}`)
    win.history.replaceState(null, '', linkExpiredUrl(err))
    return err
  } catch (e) {
    logger.warn?.('[auth-link] could not check the URL for an auth error:', e?.message)
    return null
  }
}
