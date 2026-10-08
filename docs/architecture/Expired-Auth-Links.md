# Expired auth links

The emailed auth links are password reset, staff invitation (a recovery link) and email verification. Both apps send them through `packages/shared-email/src/authEmail.js`. Each link carries a one-time token. Once that token has expired or been used, Supabase's `/verify` answers 403 ("Email link is invalid or has expired") and redirects the browser back to the app with the reason in the URL:

```
https://carefind.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
```

The reason is in the hash for implicit-flow links and in the query for PKCE (CareHub). The redirect goes to the link's `redirect_to` when that URL is allow-listed in Supabase (Auth → URL Configuration). Otherwise it goes to the Site URL, which is the home page. Production's auth logs on 2026-10-07 show exactly this case: a 403 on `/verify`, then a 303 to `https://carefind.app/`.

Until now neither app read those params, so the user simply saw the home page.

## What happens now

1. **Boot check, before the Supabase client exists.** It is the first import in `main.jsx`:
   - CareFind: `modules/account/authLinkErrorRedirect.js`, imported after `verifyEmailParams` and `recoveryRedirect`.
   - CareHub: `lib/authLinkErrorRedirect.js`.

   Both call `redirectExpiredAuthLink()` from `@care-ecosystem/shared-email/authLinkError`. If the URL carries `error`, `error_code` or `error_description` on any path, the URL is rewritten in place (`history.replaceState`, no reload) to:

   ```
   /link-expired?reason=expired|invalid&kind=password_reset|email_verification|auth
   ```

   - `reason` is `expired` for `otp_expired` and `flow_state_expired`, and `invalid` for any other error.
   - `kind` comes from the path the link was meant for: `/reset-password` gives `password_reset`, `/verify-email` gives `email_verification`, anything else gives `auth`.
   - The log line names the error code only. The URL can carry tokens, so it is never logged.

2. **Skipped paths.** CareFind's `/verify-email` has its own expired state, with a "resend verification email" action, so it is skipped.

3. **The `/link-expired` page in each app.**
   - CareFind: `modules/account/LinkExpired.jsx`.
   - CareHub: `pages/auth/LinkExpired.jsx`.

   Each page explains that the link expired or can't be used and offers:
   - **Request a new link**: CareFind `/reset-password`, CareHub `/forgot-password`;
   - **Sign in**;
   - **Go home**.

   CareFind also points business users to CareHub's reset page, because CareHub links can fall back to CareFind's Site URL. CareHub tells invited staff to ask the business to resend the invitation.

## Security

- **The page never shows text from the URL.** `error_description` is attacker-controllable, since anyone can send a crafted `carefind.app/#error_description=Call+this+number` link. The page reads only the allow-listed `reason` and `kind` values (`readLinkExpiredParams`) and shows its own copy.
- **No change to authentication.** A URL that carries an auth error never establishes a session. Removing the params before `createClient()` only stops supabase-js from processing a failed callback.
- **Rate limits unchanged.** Requesting a new link still goes through the existing rate-limited `/api/auth-email` path.

## Configuration recommendation

In Supabase → Auth → URL Configuration → Redirect URLs, allow-list `https://carefind.app/**` and `https://carefindhub.com/**`. Then reset links land on their own app's `/reset-password` (giving `kind=password_reset`) instead of on the Site URL. This is also true of successful links: today `recoveryRedirect.js` exists only because they land on `/`.

## Test plan

- Automated:
  - `packages/shared-email/src/__tests__/authLinkError.test.js`: detection (hash and query), kinds, URL-text safety, the in-place redirect, and no tokens in logs.
  - `apps/carefind/src/modules/account/__tests__/LinkExpired.test.jsx` and `apps/carehub/src/pages/auth/__tests__/LinkExpired.test.jsx`: copy per reason and kind, actions, heading focus, and ignoring URL text.
- Manual, done against both production builds in Chromium at 375px:
  - `/#error=access_denied&error_code=otp_expired…` → `/link-expired?reason=expired&kind=auth`.
  - `/reset-password?error=…&error_code=otp_expired` → `/link-expired?reason=expired&kind=password_reset`.
  - No horizontal scroll.
- Manual, in production: request a password reset, use the link once, then open it again. You should see "This link has expired" instead of the home page.
