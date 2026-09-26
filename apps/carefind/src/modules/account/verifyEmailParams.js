// Import-time capture of this page's verification-token data.
//
// Must be imported BEFORE the supabase client (see VerifyEmail.jsx and
// main.jsx): on a token-bearing landing URL, supabase-js auto-consumes the
// token from the address bar during `createClient()` at app boot (implicit
// flow clears the WHOLE hash; same-browser PKCE strips `?code=` plus
// `sb_flow_id`). By the time any effect runs, the evidence this page needs to
// judge the link is already gone. Capturing here, synchronously, at module
// evaluation, is the only place it still exists.

// Single-source location for every auth-param key the page cares about, so
// capture, presence detection, and consumed-URL derivation can never drift
// apart.
export const AUTH_QUERY_KEYS = ['code']
export const AUTH_HASH_KEYS = ['access_token', 'type', 'error', 'error_description']
export const PKCE_AUX_QUERY_KEYS = ['sb_flow_id']

// How supabase-js ACTUALLY leaves a callback URL after consuming it:
//  - implicit success -> clears the ENTIRE hash (`window.location.hash = ''`)
//  - PKCE success      -> strips only `code` (+ the `sb_flow_id` auxiliary)
// Returns the normalized consumed form so branch-3 can replay the recorded
// verdict when the live URL equals it. Returns null on any parse error.
export function consumedUrlFromHref(href) {
  try {
    const url = new URL(href)
    if (url.searchParams.has('code')) {
      AUTH_QUERY_KEYS.concat(PKCE_AUX_QUERY_KEYS).forEach((key) => url.searchParams.delete(key))
    } else {
      url.hash = ''
    }
    return url.toString()
  } catch (err) {
    console.warn('[VerifyEmail] could not derive consumed URL from snapshot:', err)
    return null
  }
}

export function currentUrlHref() {
  try {
    return typeof window !== 'undefined' ? window.location.href : ''
  } catch (err) {
    console.warn('[VerifyEmail] could not read current URL:', err)
    return ''
  }
}

// Presence-aware, not truthiness-aware: an EMPTY `?code=`, `#access_token=`
// or `?error=` still counts as present (see iteration-4 clause) so it lands on
// `expired` rather than being mistaken for "no token". Each value stays the
// raw string (or null); the has* siblings record mere presence.
// Error params arrive in the hash for implicit callbacks but can appear in
// the query too; presence counts even when the value is empty. When a location
// carries a real value and the other only an empty placeholder, the non-empty
// value wins; `''` survives only when neither location holds a value.
function pickNonEmpty(first, second) {
  if (first !== null && first !== '') return first
  if (second !== null && second !== '') return second
  if (first !== null) return first
  return second
}

export function parseVerifyEmailParams(href) {
  const params = {
    href: null,
    code: null,
    hasCode: false,
    accessToken: null,
    hasAccessToken: false,
    type: null,
    hasType: false,
    error: null,
    hasError: false,
    errorDescription: null,
    hasErrorDescription: false,
  }
  try {
    const url = new URL(href)
    params.href = url.href
    params.hasCode = url.searchParams.has('code')
    params.code = url.searchParams.get('code')
    const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
    params.hasAccessToken = hash.has('access_token')
    params.accessToken = hash.get('access_token')
    params.hasType = hash.has('type')
    params.type = hash.get('type')
    // Error params arrive in the hash for implicit callbacks but can appear in
    // the query too; presence counts even when the value is empty.
    params.hasError = url.searchParams.has('error') || hash.has('error')
    const queryError = url.searchParams.get('error')
    const hashError = hash.get('error')
    params.error = pickNonEmpty(queryError, hashError)
    params.hasErrorDescription = url.searchParams.has('error_description') || hash.has('error_description')
    const queryErrorDescription = url.searchParams.get('error_description')
    const hashErrorDescription = hash.get('error_description')
    params.errorDescription = pickNonEmpty(queryErrorDescription, hashErrorDescription)
  } catch (err) {
    console.warn('[VerifyEmail] could not parse verify-email params:', err)
  }
  return params
}

// Snapshots at module evaluation. Safe in SSR/test absence of a browser, too:
// with no window the href is empty and every field resolves to null/false.
export const capturedVerifyEmailParams = parseVerifyEmailParams(
  typeof window !== 'undefined' ? window.location.href : ''
)