# Expired auth links

The emailed auth links are password reset, staff invitation (a recovery link), owner setup (a recovery link, see below) and email verification. Both apps send them through `packages/shared-email/src/authEmail.js`. Each link carries a one-time token. Once that token has expired or been used, Supabase's `/verify` answers 403 ("Email link is invalid or has expired") and redirects the browser back to the app with the reason in the URL:

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

## Owner setup links (`owner_setup`)

A new CareHub business owner registers without a password. `POST /api/register-business` creates the owner's auth user **unconfirmed** and sends the `owner_setup` email through `sendAuthEmail` (`app: 'carehub'`). Like `staff_setup`, the link is a recovery-type action link, and it is server-initiated only: it is not reachable from the public `/api/auth-email` handler.

- **Landing.** The link's `redirect_to` is `/reset-password?welcome=1` on CareHub. `ResetPassword.jsx` reads `welcome` and shows "Email verified" / "Save password" instead of the reset copy; the session and `updateUser({ password })` logic is the same as a normal reset. The owner then signs in.
- **Expired, used or superseded link.** The same boot check applies: the URL is rewritten to `/link-expired?reason=...&kind=password_reset` (the path is `/reset-password`), and the page offers "Request a new link" (`/forgot-password`). That uses the public `password_reset` action, which also confirms the address, so it is the supported recovery for an unconfirmed owner.
- **Each minted link invalidates the previous one**, so an owner who requests a new link must use the newest email.
- **Allow-list.** `https://carefindhub.com/reset-password` (or the `/**` wildcard above) must be on the Supabase redirect allow-list, otherwise Supabase redirects to the Site URL and the owner never reaches the set-password page.
- **Unverified sign-in.** Signing in before using the link returns Supabase `email_not_confirmed`; CareHub's sign-in page shows "Verify your email to continue" with a resend control that posts `password_reset`.

Full flow, database objects, and the rollout runbook: [Owner email verification](Owner-Email-Verification.md).

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
- Manual, in production: register an owner with a real inbox, open the `owner_setup` link (expect "Email verified" on `/reset-password?welcome=1`), then open it again (expect "This link has expired"). Not yet performed; see the runbook in Owner-Email-Verification.md.
- Manual, in production: request a password reset, use the link once, then open it again. You should see "This link has expired" instead of the home page.
