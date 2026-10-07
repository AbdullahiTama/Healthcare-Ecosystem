// Must be imported BEFORE the supabase client (see main.jsx).
//
// An expired or already-used emailed link (password reset, email verification) comes back from Supabase as
// #error=access_denied&error_code=otp_expired..., usually on '/' (the Site URL). Without this the user just saw the home page.
// Moves such a URL to /link-expired, which explains it and offers a new link. /verify-email reads the same params itself and
// offers to resend the verification email, so it is left alone (verifyEmailParams has already captured them).
import { redirectExpiredAuthLink } from '@care-ecosystem/shared-email/authLinkError'

redirectExpiredAuthLink({ skipPaths: ['/verify-email'] })
