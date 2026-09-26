# 0002. CareFind Auth Email

## Summary

This child makes CareFind verification, welcome, password recovery, email change, and security notices reliable and correctly branded. It adds trusted app membership, a protected signup bridge, and the Supabase Send Email hook. It removes the custom Auth mail endpoints and keeps all Auth state in Supabase.

## Requirements

1. **AC-A-1**: A new CareFind signup creates a trusted CareFind membership before the first branded verification and welcome message is queued.
2. **AC-A-2**: Each Auth action creates exactly one outbox row and never competes with Supabase built in email sending.
3. **AC-A-3**: The Auth hook verifies the Supabase standard webhook signature and accepts no browser selected app.
4. **AC-A-4**: CareFind recovery and security mail uses only existing trusted membership or an exact approved recovery origin already associated with that membership.
5. **AC-A-5**: The message uses the CareFind domain, sender, wordmark, support details, working action link, hidden preview line, HTML, and plain text.
6. **AC-A-6**: Raw tokens and token hashes are never stored as database fields, event keys, logs, responses, or client bundle values. A time limited signed action link may exist only in the protected outbox payload until the message is sent or expires.
7. **AC-A-7**: Duplicate Auth hook calls with the same action token produce the same event key and one outbox row.
8. **AC-A-8**: CareFind signup and recovery remain generic, rate limited, accessible, and compatible with the existing verification landing page.
9. **AC-A-9**: Auth and client tests, builds, and real inbox checks pass before the Auth hook is enabled for users.

## Decision

Use a private `account_app_memberships` table as the normal ownership source. Use a short lived `account_signup_intents` row only to classify the first CareFind signup. The public `carefind-signup` Edge Function creates the intent before calling normal Supabase Auth signup. The `send-email` Auth hook reads the intent, creates the membership, renders one CareFind template, and enqueues it.

## Feature Design

### Data Model

1. `account_app_memberships`
   1. `user_id uuid` required with `ON DELETE CASCADE` to `auth.users`.
   2. `app text` required, limited to `carehub` or `carefind`.
   3. `state text` required, limited to `active` or `revoked`.
   4. `source text` required, limited to `signup_intent`, `verified_business`, `staff_ownership`, `approved_claim`, or `backfill`.
   5. `created_at` and `updated_at timestamptz` required.
   6. Primary key on user id plus app.
   7. Index on app plus state.
2. `account_signup_intents`
   1. `id uuid` primary key.
   2. `email_normalized text` required.
   3. `request_fingerprint_hash text` required.
   4. `app text` required and fixed to `carefind` for this child.
   5. `state text` required, limited to `pending`, `consumed`, or `expired`.
   6. `redirect_to text` required.
   7. `expires_at`, `consumed_at`, and `created_at timestamptz` required as applicable.
   8. Index on normalized email plus state, fingerprint plus state, and expiry.
   9. Maximum five rows for one normalized email and ten rows for one fingerprint in a rolling hour.
   10. Rows are removed after twenty four hours.
3. Auth event payload rules
   1. A temporary Auth link may be stored only in `email_outbox.payload` for an Auth template.
   2. An Auth event key is an HMAC using `AUTH_EVENT_KEY_SECRET` over app, action, user id, Auth `updated_at`, and any available token hash. The raw token and token hash are never stored.
   3. A tokenless security notice uses the same HMAC inputs with no token value. If `updated_at` is missing, the hook fails visibly.
   4. Raw `token` and `token_hash` are never stored.
   5. Payload is cleared when the row becomes accepted or another final state, and by cleanup after twenty four hours.

All tables use RLS with no public policies. Only service role functions may read or write them.

### Database Functions

1. `create_carefind_signup_intent(p_email text, p_request_fingerprint_hash text, p_redirect_to text)` returns the intent id. It is a narrow public `SECURITY DEFINER` function with fixed search path. It validates the exact `carefind.app` callback origin, applies the database rate limits, and grants no access to any other table.
2. `consume_carefind_signup_intent(p_email text, p_user_id uuid, p_intent_id uuid)` activates one unexpired CareFind membership and marks the intent consumed. It is callable only by the signed Auth hook service path.
3. `resolve_auth_app(p_user_id uuid, p_action text, p_redirect_to text)` returns a trusted app only when membership or the first signup intent proves it. It fails visibly when ambiguous.
4. `backfill_account_app_memberships(p_carefind_user_ids uuid[])` inserts exact trusted CareHub matches from active businesses, staff ownership, and approved claims. The CareFind list is an operator reviewed list of user ids from an audited CareFind user source. It is not inferred from a missing profile relationship.
5. The function writes a dry run report for every candidate and every ambiguous user. It never guesses an app from an absent relationship.
6. A user with both trusted products keeps both memberships. A user with unclear ownership stays without a membership and Auth mail fails visibly until an operator resolves it.
7. Auth mail uses the requested origin only when that app is already a membership.

### Protected Signup Bridge

1. `carefind-signup` is a public Supabase Edge Function with `verify_jwt = false` because the caller has no session.
2. `POST` accepts email, password, display name, redirect to, and an optional Supabase CAPTCHA token.
3. The function normalizes email, hashes the request fingerprint supplied by trusted edge context, validates the exact `https://carefind.app/verify-email` callback, and calls the narrow `create_carefind_signup_intent` RPC. The bridge does not receive a service role key.
4. The function calls normal Supabase Auth signup with the publishable key. It does not use Admin create user because that path does not send confirmation mail.
5. The Auth hook may run during the signup call. It finds the pending intent by normalized email, verifies the callback, creates the membership, and marks the intent consumed through the protected Auth path.
6. The bridge returns the normal generic Auth result without a second service role write.
7. Duplicate account and invalid input responses do not reveal whether an account exists.
8. The function returns `429` when the database limits are reached.

### Auth Hook

1. `send-email` has `verify_jwt = false` because Supabase calls it with a standard webhook signature rather than a user JWT.
2. The deployed payload contract uses `email_data`. A payload that uses the old `email` field is rejected.
3. The raw request is verified with the Supabase standard webhook secret before JSON parsing.
4. Supported actions are signup, recovery, invite, magic link, email change, reauthentication, password changed notification, email changed notification, phone changed notification, identity linked notification, identity unlinked notification, multi factor enrolled notification, and multi factor unenrolled notification.
5. Signup uses one combined CareFind verification and welcome template.
6. Recovery uses the official `/auth/v1/verify` URL with token hash, type `recovery`, and the exact CareFind reset callback.
7. Security notices are notification only and never include a confirmation link when no usable token exists.
8. Secure email change follows Supabase token mapping. Current email uses `token` with `token_hash_new`; new email uses `token_new` with `token_hash`.
9. The hook calls `enqueue_auth_email_event` with a deterministic HMAC event key, a short Auth enqueue proof derived from the same secret, and the temporary action link only when the template needs one.
10. The hook returns an empty success response only after the membership and outbox writes succeed.
11. The Auth hook is the only enabled Auth mail path after cutover. There is no built in SMTP fallback for a failed hook. A hook failure leaves the Auth request failed and raises a safe queue health alert.
12. Missing membership, invalid origin, invalid signature, missing secret, invalid payload, or enqueue failure returns a safe error without logging token data.

### Templates

1. `carefind_auth_verification_welcome` begins its subject with `CareFind` and combines welcome text with one verification action.
2. `carefind_password_reset` begins its subject with `CareFind` and uses the approved reset callback.
3. `carefind_security_notice` begins its subject with `CareFind`, names the security action, and provides no action link unless Supabase supplied a valid link.
4. `carefind_email_change` supports current and new recipient variants with the correct token pair.
5. Every template uses the CareFind wordmark at 240 pixels wide with proportional height, a 600 pixel table layout, inline styles, a hidden preview line, a plain text version, and no clinical field.
6. Every link uses `https://carefind.app` and the template validates the origin before rendering.

### Client Changes

1. `AuthContext.signUp` calls `carefind-signup` instead of browser Supabase signup followed by custom Auth mail requests.
2. The existing verification landing page stays unchanged. The Auth hook callback resolves to the current `window.location.origin` equivalent for the canonical `carefind.app` deployment.
3. Password recovery calls `supabase.auth.resetPasswordForEmail` with the exact CareFind reset callback. The Auth hook creates the mail.
4. The client makes no request to `/api/auth-email`, no request for welcome mail, and no request for verification mail.
5. The client continues to show generic success and error copy. It never reports inbox delivery.
6. Existing loading, error, success, responsive, and accessible states remain.

### Removed Code

1. `apps/carefind/api/_handlers/auth-email.js` is removed.
2. The CareFind `/api/auth-email` route is removed after client cutover.
3. `packages/shared-email/src/authEmail.js` and its `sendAuthEmail` export are removed.
4. The old `customer_registration` and `emailVerification` CareFind templates are removed after the combined template is proven.

### Value Sourcing

1. First signup app identity comes from the pending `account_signup_intents` row created before Auth signup.
2. Later Auth app identity comes from `account_app_memberships`.
3. Recovery destination comes from the exact client supplied callback after it is checked against the `carefind.app` allowlist and existing membership.
4. Display name comes from the verified Auth user profile when available, then the safe name supplied during signup, then the email local part.
5. Action link comes from Supabase token hash, action type, and redirect destination using the official verify endpoint.
6. Event key comes from an HMAC over app, action, user id, Auth `updated_at`, and any available token hash.
7. Subject, sender, reply address, template key, and closed payload schema come from the database catalog.
8. Wordmark and support domain come from the CareFind brand module.
9. Signup rate decision comes from counts over `account_signup_intents` created in the last hour plus Supabase Auth limits.
10. Intent lifetime is fifteen minutes. Outbox Auth payload cleanup ceiling is twenty four hours.

### Security Model

1. User metadata, local storage, arbitrary app input, and an unverified redirect never establish ownership.
2. The signup bridge stores no raw IP address and receives no service role key. It stores only a one way request fingerprint hash through the narrow intent function.
3. Passwords exist only for the duration of the TLS protected signup request and normal Supabase Auth processing. They never enter logs or the database intent.
4. The Auth hook signature is the only caller authority.
5. The Resend key is not available to the signup bridge or Auth hook. Only the minute worker can call Resend.
6. Raw Auth tokens and token hashes are never persisted in logs or event keys.
7. The signup bridge uses the publishable key only for normal signup. It does not use the service role for Auth account creation or private table writes.
8. Platform membership is private and cannot be changed by the browser.
9. The Auth hook can call only the Auth enqueue function. The generic business enqueue function rejects Auth event keys.

### Configuration Required

1. `SEND_EMAIL_HOOK_SECRET` is a Supabase Edge Function secret.
2. `AUTH_EVENT_KEY_SECRET` is available only to the Auth hook.
3. `SUPABASE_SERVICE_ROLE_KEY` is available only to the Auth hook for protected Auth enqueue and membership writes. It is not available to the public signup bridge.
4. `SUPABASE_PUBLISHABLE_KEY` is available to the signup bridge for normal Auth signup.
5. The Auth hook is deployed with `verify_jwt = false` and standard webhook verification.
6. The `carefind-signup` function is deployed with `verify_jwt = false` and its own public rate limits.
7. Supabase Auth allows `https://carefind.app/verify-email` and `https://carefind.app/reset-password`.
8. Supabase Auth email confirmation remains enabled for CareFind consumer signups while the Auth hook and verification landing page are active.

### Critical Test Scenarios

1. A valid new signup creates one membership, one combined outbox row, and one CareFind message. Verifies **AC-A-1**, **AC-A-2**, and **AC-A-5**.
2. Replaying the same signed hook request returns the same outbox row. Verifies **AC-A-7**.
3. A forged app value in user metadata does not change brand selection. Verifies **AC-A-3** and **AC-A-4**.
4. A recovery request for an ambiguous account fails visibly without sending the wrong brand. Verifies **AC-A-4**.
5. Database inspection finds no raw token, token hash, password, or full action link after cleanup. Verifies **AC-A-6**.
6. Eleven signup requests from one fingerprint in an hour receive `429`. Verifies **AC-A-8**.
7. The old Auth mail route receives `410` and no client references remain. Verifies **AC-A-2**.
8. Gmail and Outlook on web and mobile show the correct logo, sender, link, and plain text. Verifies **AC-A-5** and **AC-A-9**.
9. The public signup bridge has no service role key and can write only a rate limited intent through its narrow RPC. Verifies **AC-A-3** and **AC-A-8**.
10. An ambiguous existing user is absent from the dry run membership report and receives no guessed brand. Verifies **AC-A-4**.
11. A hook payload using the legacy `email` field is rejected without a token log. Verifies **AC-A-3** and **AC-A-6**.

## Build Plan

1. Add and apply app membership, signup intent, backfill, resolution, and rate limit functions with database tests. Satisfies **AC-A-1**, **AC-A-4**, and **AC-A-8**.
2. Build and test the pure Auth event mapping, secure email change mapping, event key hashing, and CareFind Auth templates. Satisfies **AC-A-5**, **AC-A-6**, and **AC-A-7**.
3. Build and deploy the signed `send-email` Auth hook against the foundation catalog. Satisfies **AC-A-2**, **AC-A-3**, **AC-A-6**, and **AC-A-7**.
4. Build and deploy `carefind-signup`, connect it to normal Supabase signup, and backfill existing trusted memberships. Satisfies **AC-A-1**, **AC-A-4**, and **AC-A-8**.
5. Move CareFind client signup and recovery, then remove custom Auth mail routes and old Auth sender code. Satisfies **AC-A-2** and **AC-A-8**.
6. Run app tests and builds, function fixtures, database checks, and the Gmail and Outlook matrix before enabling the Auth hook. Satisfies **AC-A-9**.

## Consequences

1. CareFind signup gains a protected bridge but keeps normal Supabase confirmation behavior.
2. The Auth hook and signup bridge add Deno functions and private database tables.
3. The first signup message is branded because the intent exists before Auth calls the hook.
4. Accounts with two trusted memberships require an exact origin or fail visibly rather than guessing.

## Rationale

A private membership table supports users in both products and gives security notices a trusted source. A short lived signup intent solves the first message timing problem without trusting editable user metadata. The Auth hook replaces both Supabase built in sending and the old custom Auth mail path, so one action has one mail path.
