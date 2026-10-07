// Must be imported BEFORE the Supabase client (first import in main.jsx).
//
// An expired or already-used emailed link (password reset, staff invitation) comes back from Supabase as
// ?error=access_denied&error_code=otp_expired... (or in the hash), on /reset-password or on the Site URL. On the Site URL the user
// just saw the landing page. Moves such a URL to /link-expired, which explains it and offers a new link.
import { redirectExpiredAuthLink } from '@care-ecosystem/shared-email/authLinkError'

redirectExpiredAuthLink()
