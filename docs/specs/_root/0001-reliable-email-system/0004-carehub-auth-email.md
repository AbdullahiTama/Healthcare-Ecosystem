# 0004. CareHub Auth Email

## Summary

This child gives CareHub owners and staff reliable password recovery and security notices through the shared Supabase Auth hook. CareHub accounts are server confirmed, so this child does not send a separate verification link. It reuses trusted CareHub app membership, the shared outbox, and the CareHub brand rules.

## Requirements

1. **AC-C-1**: A CareHub owner or staff member can request a password reset and receives one correctly branded recovery message.
2. **AC-C-2**: CareHub security notices use trusted CareHub membership and never use editable user metadata to choose a brand.
3. **AC-C-3**: The recovery link uses the official Supabase verify endpoint, the exact `carefindhub.com/reset-password` callback, and no stored plaintext password.
4. **AC-C-4**: The CareHub client keeps generic responses, loading states, error states, and accessible recovery navigation.
5. **AC-C-5**: The shared Auth hook is the only Auth mail path, and built in Auth mail does not compete with it.
6. **AC-C-6**: CareHub Auth tests, builds, permission probes, and real inbox checks pass before the hook is enabled for CareHub users.

## Decision

Use the shared `send-email` Auth hook and `account_app_memberships` table. CareHub registration and staff provisioning create the trusted membership in the same database transaction as their account records. Recovery uses a fixed CareHub callback and a CareHub reset template. Security notices are notification only and contain no clinical or patient data.

## Feature Design

### Data Model

This child adds no new table. It uses:

1. `account_app_memberships` with app `carehub`, state `active`, and a trusted source from verified business or staff ownership.
2. `email_event_catalog` entries for `password_reset`, security notices, and the CareHub reset callback.
3. `email_outbox` with a temporary Auth payload and the same state, claim, provider, and retention rules as the CareFind child.
4. The Auth hook HMAC event key from `AUTH_EVENT_KEY_SECRET`.

The catalog payload schema is closed. A CareHub recovery payload accepts only the approved display name, action link, and safe action label. It rejects unknown fields and values over the catalog limits.

### Auth Hook Contract

1. The deployed `send-email` function uses the `email_data` payload field. The legacy `email` field is rejected.
2. The function verifies the Supabase standard webhook signature before parsing.
3. It resolves `carehub` only from active `account_app_memberships` or the exact CareHub recovery callback already associated with a CareHub membership.
4. It handles recovery, password changed, email changed, phone changed, identity linked, identity unlinked, multi factor enrolled, multi factor unenrolled, and reauthentication actions.
5. It calls `enqueue_auth_email_event` with a short Auth enqueue proof and never calls the generic business enqueue function.
6. It returns success only after the outbox write succeeds. It does not claim that the inbox received mail.
7. Missing membership, invalid callback, missing hook secret, invalid signature, invalid payload, and enqueue failure return a safe error and raise a health alert.
8. The hook has no user JWT authority. Its standard webhook signature is the only caller authority.

### Recovery Flow

1. `ForgotPassword.jsx` calls `supabase.auth.resetPasswordForEmail` with `https://carefindhub.com/reset-password`.
2. Supabase sends the signed Auth hook request when its Auth email provider is enabled and the hook is active.
3. The hook generates the official verify URL with `token_hash`, type `recovery`, and the approved CareHub callback.
4. The CareHub reset template stores the temporary link only in the protected outbox payload and clears it after the message reaches a final state.
5. The client shows generic success whether or not an account exists. It never displays the generated link.
6. The existing reset page handles the callback, validates the session, and keeps its current accessible states.

### Templates

1. `carehub_password_reset` begins its subject with `CareHub` and uses `https://carefindhub.com/logo-wordmark.png`.
2. The message uses `CareHub <support@carefindhub.com>`, reply address `support@carefindhub.com`, the CareHub wordmark at 240 pixels wide, a 600 pixel table layout, inline styles, a hidden preview line, and plain text.
3. The action link is checked against `https://carefindhub.com` before rendering.
4. Security notices use fixed copy for the Auth action and do not include a link unless Supabase supplies a valid action token.
5. No template contains a password, patient identifier, clinical detail, or free text internal note.
6. CareHub templates never fall back to CareFind branding.

### Client Changes

1. `ForgotPassword.jsx` uses the Supabase client method and no custom `/api/auth-email` request.
2. The client keeps its generic success copy, loading state, error state, and resend guidance.
3. The client uses the canonical CareHub reset callback and does not use `process.env` for email links.
4. The client does not change Auth session ownership or business authorization.
5. The existing `ResetPassword.jsx` remains the only page that changes a password.

### Removed Code

1. `apps/carehub/api/_handlers/auth-email.js` and the CareHub `/api/auth-email` route are removed after client cutover.
2. `packages/shared-email/src/authEmail.js` and its `sendAuthEmail` export are removed after the shared hook is active.
3. The old CareHub Auth mail templates are removed after the catalog templates pass tests.

### Value Sourcing

1. CareHub app identity comes from `account_app_memberships`.
2. Recovery display name comes from the verified Auth profile, then the safe existing business owner name, then the email local part.
3. Recovery action link comes from Supabase `token_hash`, action type `recovery`, and the fixed `carefindhub.com` callback.
4. Event key comes from the shared Auth HMAC over app, action, user id, Auth `updated_at`, and token hash.
5. Subject, sender, reply address, template key, and closed payload schema come from the database catalog.
6. Logo, support address, and link origin come from the CareHub brand module.
7. Password and token values never enter a response, log, event key, or database column other than the protected temporary outbox payload.

### Security Model

1. The Auth hook standard signature is the only caller authority.
2. The hook cannot select an app from user metadata, local storage, or an arbitrary redirect.
3. CareHub membership is private and is created only by trusted business or staff ownership paths.
4. The public CareHub recovery UI is generic and rate limited by Supabase Auth.
5. The Resend key is not available to the recovery client or Auth hook.
6. The catalog rejects clinical and unknown payload fields before a row is created.
7. The built in Auth sender is not used after the hook is enabled.

### Configuration Required

1. `SEND_EMAIL_HOOK_SECRET` is available to the shared Auth hook.
2. `AUTH_EVENT_KEY_SECRET` is available only to the shared Auth hook.
3. The Supabase Auth redirect allowlist includes `https://carefindhub.com/reset-password`.
4. The `carefindhub.com` Resend domain is verified before the hook is enabled.
5. Supabase Auth email provider is enabled and the built in Auth sender is not competing with the hook.

### Critical Test Scenarios

1. A CareHub owner requests recovery and one CareHub message reaches the test inbox. Verifies **AC-C-1** and **AC-C-3**.
2. A user with only CareFind membership cannot receive a CareHub recovery message through a CareHub callback. Verifies **AC-C-2**.
3. A forged user metadata app value does not change the template. Verifies **AC-C-2**.
4. An invalid or missing hook signature creates no membership, outbox row, or log containing token data. Verifies **AC-C-5**.
5. A CareHub recovery link opens the approved reset page and updates the password through the existing session flow. Verifies **AC-C-3** and **AC-C-4**.
6. Gmail and Outlook on web and mobile show the CareHub wordmark, sender, and working link. Verifies **AC-C-1**, **AC-C-4**, and **AC-C-6**.

## Build Plan

1. Seed the CareHub Auth catalog entries and templates, with the shared hook and trusted membership checks. Satisfies **AC-C-1**, **AC-C-2**, and **AC-C-3**.
2. Move the CareHub forgot and reset client flow to normal Supabase Auth methods and add generic response tests. Satisfies **AC-C-4**.
3. Remove the old CareHub Auth mail route, sender, and old templates after caller searches are clean. Satisfies **AC-C-5**.
4. Run CareHub tests and builds, Auth hook fixtures, permission probes, and the Gmail and Outlook matrix. Satisfies **AC-C-6**.

## Consequences

1. CareHub gets a second Auth child because it shares the hook but has a different account confirmation model.
2. Recovery mail cannot be enabled until CareHub memberships have a reviewed backfill.
3. The shared hook has one more supported app and one more brand path, so its contract tests must cover both apps.

## Rationale

CareHub users are confirmed during provisioning, so verification is unnecessary, but recovery and security notices still need the same reliability and privacy guarantees as CareFind. Trusted membership plus the shared hook prevents a client supplied domain from choosing the wrong brand.
