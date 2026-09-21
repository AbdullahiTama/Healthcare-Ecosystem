// Import-time capture of this page's verification-token data.
//
// Must be imported BEFORE the supabase client (see VerifyEmail.jsx): on a
// token-bearing landing URL, supabase-js auto-consumes the token from the
// address bar during `createClient()` at app boot (implicit flow clears the
// hash; same-browser PKCE strips the `?code=`). By the time any effect runs,
// the evidence this page needs to judge the link is already gone. Capturing
// here, synchronously, at module evaluation, is the only place it still
// exists.

export function parseVerifyEmailParams(href) {
  const params = {
    code: null,
    accessToken: null,
    type: null,
    error: null,
    errorDescription: null,
  }
  try {
    const url = new URL(href)
    params.code = url.searchParams.get('code')
    const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
    params.accessToken = hash.get('access_token')
    params.type = hash.get('type')
    params.error = hash.get('error')
    params.errorDescription = hash.get('error_description')
  } catch (err) {
    console.warn('[VerifyEmail] could not parse verify-email params:', err)
  }
  return params
}

// Snapshots at module evaluation. Safe in SSR/test absence of a browser, too:
// with no window the href is empty and every field resolves to null.
export const capturedVerifyEmailParams = parseVerifyEmailParams(
  typeof window !== 'undefined' ? window.location.href : ''
)