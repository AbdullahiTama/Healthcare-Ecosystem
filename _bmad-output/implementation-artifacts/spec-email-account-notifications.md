---
title: 'Email & Account Notifications + Forgot Password'
type: 'feature'
created: '2026-08-28'
status: 'done'
baseline_commit: 'bde28107ddf5845eb2b9404e8bd27d6d3f155e09'
review_loop_iteration: 0
context:
  - 'docs/PROJECT_OVERVIEW.md'
  - 'architecture/Current-Architecture.md'
  - 'planning/CODE_AUDIT.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Business owners receive no confirmation email after registration (only an in-app thank-you), and status-change emails (approved/rejected/review) are attempted client-side via `lib/email.js` which reads `process.env.RESEND_API_KEY` in the Vite bundle — always empty, so sends silently fail. Forgot Password does not exist: `Login.jsx` has no link and `authClient.js` exposes only `signInWithPassword`.

**Approach:** Move all email delivery server-side via Resend from Vercel API routes. On registration send two emails (owner confirmation “under review” + admin alert). On admin approve/reject/suspend/reactivate send owner email. Add Forgot Password (request link) + Reset Password (set new password via Supabase Auth recovery) pages with loading/error/success states.

## Boundaries & Constraints

**Always:** Email sending is server-side only (never expose `RESEND_API_KEY` in client bundle); use `process.env.RESEND_API_KEY` + `FROM_EMAIL` on server. Verify Supabase Auth session where required. Keep existing `lib/email.js` templates as the HTML source of truth but render them server-side. All new pages follow shared UI (`components/ui`) with loading/error/empty/responsive/a11y states. Business registration must still succeed even if email delivery fails (do not block `register_business` RPC).

**Ask First:** If `RESEND_API_KEY` is missing in production, whether to fallback to logging vs failing. Changing `FROM_EMAIL` domain (currently `onboarding@resend.dev`) to a verified `carehub.ng` domain. Whether to add rate-limiting on forgot-password requests.

**Never:** Do not ship client-side `fetch('https://api.resend.com/emails')` with an API key. Do not weaken auth (no plaintext password handling, no bypassing Supabase Auth). Do not modify pricing, wallet, appointment/services, or referrer logic — those are deferred goals. Do not add a second email provider.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Registration confirmation | Valid `registerBusiness` with `ownerEmail` | Owner receives “Registration received — under review” email (HTML from template) within the same request lifecycle, fire-and-forget | If Resend fails, swallow and log server-side; registration still returns success; show in-app confirmation regardless |
| Admin new-registration alert | Same registration | Admin (`admin@carehub.ng`) receives “New Business Registration” table email | Same swallow-and-log; never blocks registration |
| Approve business | Admin sets `status=active` via `AdminDashboard` | Owner receives `emailBusinessApproved` welcome email with login details | If send fails, status change still persists; toast shows “Approved! Email failed — will retry” and log server-side |
| Reject/suspend/reactivate | Admin status transitions | Owner receives `emailBusinessRejected` (with reason if provided) or status-specific email | Same never-block persistence rule |
| Forgot password request | User enters registered email on `/forgot-password` | Call `authClient.auth.resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`; show “If that email exists, a reset link has been sent” (do not leak existence) | Validate email format; show inline error for empty/invalid; network errors show retryable error toast |
| Reset password | User opens `/reset-password?code=…` (Supabase recovery), enters new password + confirm | Call `authClient.auth.updateUser({ password })`; on success redirect to `/login` with success toast | If session missing/expired, show “Link expired, request a new one” + CTA to `/forgot-password`; password <6 chars or mismatch shows inline error |
| Email missing in Supabase Auth | Forgot password for email with no `auth.users` row | Same generic success message (do not reveal) | No error leak |
| Resend key missing | Server `RESEND_API_KEY` empty | Log warning, skip send, do not throw to client | Admin dashboard + registration still succeed |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/lib/email.js:1` -- Client-side Resend sender (reads `process.env.RESEND_API_KEY`, `FROM_EMAIL`). Exports 8 templates; must become server-only.
- `apps/carehub/src/pages/auth/Register.jsx:57` -- Calls `registerBusiness` then `emailAdminNewRegistration` client-side (fire-and-forget, swallowed error). Switch to `POST /api/notify-registration`.
- `apps/carehub/src/pages/auth/Login.jsx:1` -- No forgot-password UI. Add link to `/forgot-password`.
- `apps/carehub/src/pages/admin/AdminDashboard.jsx:34` -- `updateStatus` PATCHes then calls email client-side (same bug). Switch to `POST /api/notify-business-status`.
- `apps/carehub/src/lib/authClient.js:1` -- Supabase client (`createClient(SB_URL, SB_KEY)`). Use `resetPasswordForEmail` + `updateUser`.
- `apps/carehub/src/App.jsx:7` -- Route table. Add public `/forgot-password` and `/reset-password`.
- `apps/carehub/api/_lib/paystack.js:1` -- Server handler pattern (service-role client). New `api/_lib/email.js`, `api/notify-*.js` follow it.
- `apps/carehub/.env.example:1` -- Add `RESEND_API_KEY`/`RESEND_FROM_EMAIL` docs; server reads `process.env` (not Vite).
- `apps/carehub/src/components/ui/index.jsx:1` -- Shared UI (`Card`,`Inp`,`TealBtn`,`useToast`). New pages reuse it.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/api/_lib/email.js` -- Create server-only Resend helper (`sendEmail({ to, subject, html })`) using `process.env.RESEND_API_KEY`/`RESEND_FROM_EMAIL`, with `fetch('https://api.resend.com/emails')`, error logging, never throwing to block caller — rationale: centralizes templates + keeps key server-side.
- [x] `apps/carehub/api/notify-registration.js` -- Server endpoint called after `register_business` to send both admin alert + owner confirmation (reusing `email.js` HTML builders). Validates `businessName/ownerEmail` body, sends in parallel, swallows email errors, returns `{ok:true}` -- rationale: fire-and-forget without blocking registration.
- [x] `apps/carehub/api/notify-business-status.js` -- Server endpoint for approve/reject/suspend/reactivate to send owner email (`emailBusinessApproved`/`emailBusinessRejected` with reason). Requires service-role auth check (admin session) -- rationale: moves email off client, fixes `process.env` bug, keeps status change atomic.
- [x] `apps/carehub/src/lib/email.js` -- Remove client-side `sendEmail` fetch to Resend; keep only pure HTML template builders (`build*Html`) or re-export server helpers as no-ops for backward import safety. Ensure no `process.env.RESEND_API_KEY` remains in client bundle -- rationale: closes key exposure + fixes silent failure.
- [x] `apps/carehub/src/pages/auth/Register.jsx` -- Replace direct `emailAdminNewRegistration` import with `fetch('/api/notify-registration', {method:'POST', body:JSON.stringify(...)})` fire-and-forget after successful `registerBusiness`; add owner confirmation UI text (“check your email”) on done screen -- rationale: delivers required owner confirmation + admin alert via server.
- [x] `apps/carehub/src/pages/admin/AdminDashboard.jsx` -- Replace client email calls in `updateStatus` with `fetch('/api/notify-business-status', {method:'POST', headers:{Authorization: Bearer <session>}, body:{businessId,status,reason}})` after successful `updateBusiness`; toast on email failure but keep status change -- rationale: ensures review/approve/requires-action notifications actually send.
- [x] `apps/carehub/src/pages/auth/ForgotPassword.jsx` -- New page at `/forgot-password`: email input, submit calls `authClient.auth.resetPasswordForEmail(email, {redirectTo: location.origin + '/reset-password'})`, loading spinner, inline validation, generic success message, link back to login -- rationale: fulfills “request password-reset email” requirement.
- [x] `apps/carehub/src/pages/auth/ResetPassword.jsx` -- New page at `/reset-password`: on mount check `authClient.auth.getSession()` has recovery session (Supabase sets it from URL hash/code); form with new password + confirm, submit calls `authClient.auth.updateUser({password})`, success redirect to `/login` with toast, expired-link error with CTA to `/forgot-password` -- rationale: fulfills “securely reset through link” requirement.
- [x] `apps/carehub/src/App.jsx` -- Add public routes `/forgot-password` (`<ForgotPassword/>`) and `/reset-password` (`<ResetPassword/>`) outside auth guards; ensure `Login.jsx` renders “Forgot password?” link to `/forgot-password` -- rationale: wires new flows into navigation.
- [x] `apps/carehub/.env.example` + `apps/carehub/src/lib/__tests__/email.test.js` (or update existing) -- Document `RESEND_API_KEY`/`RESEND_FROM_EMAIL` in `.env.example`; add unit tests for template builders and for forgot/reset pages (mock `authClient`) covering I/O matrix -- rationale: docs + prevents regression of silent email failure.

**Acceptance Criteria:**
- Given a new business registers with valid data, when `registerBusiness` succeeds, then the owner receives a confirmation email stating application is under review AND admin receives new-registration alert (verify via server logs / Resend dashboard; client still shows “Registration submitted” even if Resend is down).
- Given an admin approves a pending business in `AdminDashboard`, when `updateStatus(id,'active')` succeeds, then the owner receives an approval/welcome email; reject/suspend/reactivate similarly trigger the correct template with reason when provided.
- Given a user visits `/login`, when they click “Forgot password?”, then they navigate to `/forgot-password` which renders an accessible form (labelled email, submit button, error region with `role=alert`).
- Given a user submits a valid email on `/forgot-password`, when `resetPasswordForEmail` is called, then the UI shows generic success “If an account exists, a reset link has been sent” without leaking existence, and Supabase sends the recovery email with `redirectTo` = `origin/reset-password`.
- Given a user opens the reset link and lands on `/reset-password` with a valid recovery session, when they submit matching passwords ≥6 chars, then `updateUser` succeeds and they are redirected to `/login` with success toast; expired/invalid link shows error + link to request new one.
- Given `RESEND_API_KEY` is missing, when any email trigger fires, then no exception bubbles to the client; server logs a warning and the business flow (registration/status change) still completes.
- Given `apps/carehub/src/lib/email.js` is inspected, when searching for `RESEND_API_KEY` in client bundle, then no client file imports or embeds the key (only `api/_lib/email.js` references it).

## Spec Change Log

## Design Notes

Reuse HTML from `lib/email.js`; server helper only wraps `fetch`. Recovery is `resetPasswordForEmail` → email → `updateUser`; `redirectTo` must be allowed in Supabase Dashboard > Auth > URL Configuration.

## Verification

**Commands:**
- `npm run build` in `apps/carehub` -- expected: clean build, no `RESEND_API_KEY` in `dist/assets/*.js`
- `npm test run` in `apps/carehub` -- expected: existing + new email/forgot/reset tests pass
- `grep -r RESEND_API_KEY apps/carehub/src` -- expected: zero hits after refactor

**Manual checks:**
- Register business → owner + admin inboxes receive emails; approve → owner receives approval; forgot→reset→login with new password succeeds

## Suggested Review Order

**Server email plumbing — entry point**

- Server Resend helper centralizes templates and keeps key server-side
  [`email.js:1`](../../apps/carehub/api/_lib/email.js#L1)

- Registration endpoint sends owner confirmation + admin alert in parallel, never blocks
  [`notify-registration.js:1`](../../apps/carehub/api/notify-registration.js#L1)

- Status endpoint verifies admin session then sends approve/reject/suspend email
  [`notify-business-status.js:1`](../../apps/carehub/api/notify-business-status.js#L1)

**Client integration — registration & admin**

- Client templates now pure builders, no Resend key in bundle
  [`email.js:1`](../../apps/carehub/src/lib/email.js#L1)

- Registration fires fire-and-forget to server and shows “check your email” confirmation
  [`Register.jsx:53`](../../apps/carehub/src/pages/auth/Register.jsx#L53)

- Admin status change posts to server with bearer token, fire-and-forget
  [`AdminDashboard.jsx:34`](../../apps/carehub/src/pages/admin/AdminDashboard.jsx#L34)

**Forgot / Reset password flow**

- Forgot form validates email, calls resetPasswordForEmail with redirectTo, generic success
  [`ForgotPassword.jsx:1`](../../apps/carehub/src/pages/auth/ForgotPassword.jsx#L1)

- Reset form handles both code and hash flows, validates length/match, updates user
  [`ResetPassword.jsx:1`](../../apps/carehub/src/pages/auth/ResetPassword.jsx#L1)

- Login now exposes “Forgot password?” link
  [`Login.jsx:100`](../../apps/carehub/src/pages/auth/Login.jsx#L100)

- Public routes wired outside auth guards
  [`App.jsx:7`](../../apps/carehub/src/App.jsx#L7)

**Config & tests — peripherals**

- Env example documents Resend keys as server-only
  [`.env.example:16`](../../apps/carehub/.env.example#L16)

- Builder unit tests cover under-review, table, welcome, reason and key-leak guard
  [`email.test.js:1`](../../apps/carehub/src/lib/__tests__/email.test.js#L1)

- Component tests mock authClient and cover generic success, expired link, validation
  [`forgotReset.test.jsx:1`](../../apps/carehub/src/pages/auth/__tests__/forgotReset.test.jsx#L1)
